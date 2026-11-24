import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { foods, portions, foodNutrients, foodComponents } from '../db/schema.ts';
import type { NutrientAmounts } from '../nutrition/amounts.ts';
import { normalizeSearch } from '../importers/source.ts';

export type FoodSearchResult = {
  id: string;
  name: string;
  nameEn: string | null;
  brand: string | null;
  barcode: string | null;
  kind: 'generic' | 'branded' | 'dish' | 'custom';
  sourceId: string;
  sourceName: string;
  energyKcal: number | null;
  proteinG: number | null;
  match: 'barcode' | 'learned_alias' | 'default' | 'alias' | 'name' | 'text' | 'fuzzy';
};

const resultLimit = 100;

export async function searchFoods(
  db: Database,
  phrase: string,
  {
    source,
    limit = 12,
    preferredSlvId
  }: { source?: string; limit?: number; preferredSlvId?: string } = {}
): Promise<FoodSearchResult[]> {
  const query = normalizeSearch(phrase);
  if (!query) return [];
  const maxResults = Math.max(1, Math.min(resultLimit, Math.trunc(limit)));
  return db.execute<FoodSearchResult>(sql`
    WITH matched_aliases AS (
      SELECT food_id, bool_or(source = 'learned') AS learned
      FROM food_aliases WHERE alias = ${query} GROUP BY food_id
    ), ranked AS (
      SELECT
        f.id, f.name, f.name_en AS "nameEn", f.brand, f.barcode, f.kind,
        f.source_id AS "sourceId", s.name AS "sourceName",
        CASE
          WHEN f.barcode = ${query} THEN 1
          WHEN a.learned THEN 2
          WHEN f.source_id = 'slv' AND f.source_food_id = ${preferredSlvId ?? null} THEN 2.5
          WHEN a.food_id IS NOT NULL THEN 3
          WHEN lower(unaccent(f.name)) = ${query} OR lower(unaccent(f.name_en)) = ${query}
            OR lower(unaccent(concat_ws(' ', nullif(f.brand, ''), f.name))) = ${query} THEN 4
          WHEN to_tsvector('simple', f.search_text) @@ plainto_tsquery('simple', ${query}) THEN 5
          ELSE 6
        END AS tier,
        EXISTS (
          SELECT 1 FROM log_entry_items i
          JOIN log_entries e ON e.id = i.entry_id
          WHERE i.food_id = f.id AND i.removed_at IS NULL AND e.status = 'active'
            AND e.logged_at >= now() - interval '90 days'
        ) AS recent,
        f.favorite,
        CASE f.source_id WHEN 'user' THEN 0 WHEN 'slv' THEN 1 WHEN 'fdc' THEN 2 WHEN 'off' THEN 3 ELSE 4 END AS priority,
        word_similarity(${query}, f.search_text) AS similarity
      FROM foods f
      JOIN food_sources s ON s.id = f.source_id
      LEFT JOIN matched_aliases a ON a.food_id = f.id
      WHERE (${source ?? null}::text IS NULL OR f.source_id = ${source ?? null})
        AND (
          f.barcode = ${query} OR a.food_id IS NOT NULL
          OR (f.source_id = 'slv' AND f.source_food_id = ${preferredSlvId ?? null})
          OR lower(unaccent(f.name)) = ${query} OR lower(unaccent(f.name_en)) = ${query}
          OR lower(unaccent(concat_ws(' ', nullif(f.brand, ''), f.name))) = ${query}
          OR to_tsvector('simple', f.search_text) @@ plainto_tsquery('simple', ${query})
          OR (${query.length} >= 3 AND ${query} <% f.search_text)
        )
      ORDER BY tier, recent DESC, favorite DESC, priority, similarity DESC, f.name, f.id
      LIMIT ${maxResults}
    )
    SELECT r.id, r.name, r."nameEn", r.brand, r.barcode, r.kind, r."sourceId", r."sourceName",
      CASE r.tier WHEN 1 THEN 'barcode' WHEN 2 THEN 'learned_alias' WHEN 2.5 THEN 'default' WHEN 3 THEN 'alias'
        WHEN 4 THEN 'name' WHEN 5 THEN 'text' ELSE 'fuzzy' END AS match,
      kcal.amount AS "energyKcal", protein.amount AS "proteinG"
    FROM ranked r
    LEFT JOIN food_nutrients kcal ON kcal.food_id = r.id AND kcal.nutrient_id = 'energy_kcal'
    LEFT JOIN food_nutrients protein ON protein.food_id = r.id AND protein.nutrient_id = 'protein_g'
    ORDER BY r.tier, r.recent DESC, r.favorite DESC, r.priority, r.similarity DESC, r.name, r.id
  `);
}

export async function getFood(db: Pick<Database, 'select'>, id: string) {
  const [food] = await db.select().from(foods).where(eq(foods.id, id));
  if (!food) return null;
  const [portionRows, nutrientRows, componentRows] = await Promise.all([
    db
      .select()
      .from(portions)
      .where(eq(portions.foodId, id))
      .orderBy(desc(portions.isDefault), portions.label),
    db.select().from(foodNutrients).where(eq(foodNutrients.foodId, id)),
    db
      .select()
      .from(foodComponents)
      .where(eq(foodComponents.parentFoodId, id))
      .orderBy(foodComponents.sortOrder)
  ]);
  const nutrients: NutrientAmounts = Object.fromEntries(
    nutrientRows.map(({ nutrientId, amount }) => [nutrientId, amount])
  );
  return { ...food, portions: portionRows, nutrients, nutrientRows, components: componentRows };
}
