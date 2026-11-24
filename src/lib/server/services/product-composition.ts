import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../db/client.ts';
import { foodNutrients, foods, productIngredients } from '../db/schema.ts';
import { normalizeSearch } from '../importers/source.ts';
import type { NutrientAmounts } from '../nutrition/amounts.ts';
import type { IngredientEvidence } from '../nutrition/ingredient-evidence.ts';
import { estimateIngredientNutrients } from '../nutrition/ingredient-nutrients.ts';
import type { getFood } from './catalog.ts';

type Reader = Pick<Database, 'select' | 'execute'>;
type CatalogFood = NonNullable<Awaited<ReturnType<typeof getFood>>>;

export async function getProductIngredients(
  db: Pick<Database, 'select'>,
  food: Pick<CatalogFood, 'id' | 'sourceVersion'>
) {
  const [record] = await db
    .select()
    .from(productIngredients)
    .where(
      and(
        eq(productIngredients.foodId, food.id),
        eq(productIngredients.foodVersion, food.sourceVersion)
      )
    );
  return record;
}

export async function saveProductIngredients(
  db: Database | DatabaseTransaction,
  food: Pick<CatalogFood, 'id' | 'sourceVersion'>,
  evidence: IngredientEvidence | null,
  sourceUrl: string | null,
  labelNutrients?: { sourceUrl: string; values: NutrientAmounts }
) {
  const foodVersion = food.sourceVersion;
  const fromUser = evidence !== null && sourceUrl === null;
  const checkedAt = new Date();
  if (evidence) {
    const declared = new Set(
      Array.from(
        evidence.text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|procent\b|percent\b)/giu),
        ([, value]) => Number(value!.replace(',', '.'))
      )
    );
    evidence = {
      ...evidence,
      components: evidence.components.map(({ percent, ...component }) => ({
        ...component,
        percent: percent !== null && declared.has(percent) ? percent : null
      }))
    };
  }
  await db
    .insert(productIngredients)
    .values({ foodId: food.id, foodVersion, evidence, sourceUrl, labelNutrients, checkedAt })
    .onConflictDoUpdate({
      target: productIngredients.foodId,
      set: {
        foodVersion,
        evidence,
        sourceUrl,
        checkedAt,
        ...(labelNutrients
          ? { labelNutrients }
          : fromUser
            ? {
                labelNutrients: sql`case when ${productIngredients.foodVersion} = ${foodVersion}
                  then ${productIngredients.labelNutrients} else null end`
              }
            : { labelNutrients: null })
      },
      setWhere: and(
        sql`exists (select 1 from ${foods} where ${foods.id} = ${food.id} and ${foods.sourceVersion} = ${foodVersion})`,
        fromUser
          ? undefined
          : or(
              ne(productIngredients.foodVersion, foodVersion),
              isNull(productIngredients.evidence),
              evidence ? isNotNull(productIngredients.sourceUrl) : undefined
            )
      )
    });
}

export async function productComposition(
  db: Reader,
  food: CatalogFood,
  label: NutrientAmounts = {}
) {
  const documented = { ...food.nutrients, ...label };
  const empty = { documented, estimates: {} as NutrientAmounts };
  const record = await getProductIngredients(db, food);
  for (const [id, amount] of Object.entries(record?.labelNutrients?.values ?? {})) {
    const nutrient = id as keyof NutrientAmounts;
    if (documented[nutrient] == null) documented[nutrient] = amount;
  }
  if (!record?.evidence) return empty;

  const ingredients = record.evidence.components.map(({ catalogNames, name, percent }) => ({
    percent,
    names: [...catalogNames, name].map(normalizeSearch).filter(Boolean)
  }));
  const names = [...new Set(ingredients.flatMap((item) => item.names))];
  if (!names.length) return empty;

  const matches = await db.execute<{ name: string; foodId: string }>(sql`
    WITH names AS (
      SELECT unnest(ARRAY[${sql.join(
        names.map((name) => sql`${name}`),
        sql`, `
      )}]::text[]) AS name
    ), matches AS (
      SELECT n.name, f.id, f.source_id, 0 AS rank
      FROM names n JOIN foods f ON n.name IN (lower(unaccent(f.name)), lower(unaccent(f.name_en)))
      WHERE f.source_id IN ('slv', 'fdc') AND f.kind IN ('generic', 'dish')
      UNION ALL
      SELECT n.name, f.id, f.source_id, 1 AS rank
      FROM names n JOIN food_aliases a ON a.alias = n.name JOIN foods f ON f.id = a.food_id
      WHERE a.source <> 'learned' AND f.source_id IN ('slv', 'fdc') AND f.kind IN ('generic', 'dish')
    )
    SELECT DISTINCT ON (name) name, id AS "foodId"
    FROM matches
    ORDER BY name, rank, CASE WHEN source_id = 'slv' THEN 0 ELSE 1 END, id
  `);
  const byName = new Map(matches.map(({ name, foodId }) => [name, foodId]));
  const references = ingredients.map(({ names: aliases, percent }) => {
    const alias = aliases.find((value) => byName.has(value));
    return alias ? { foodId: byName.get(alias)!, percent } : null;
  });
  if (!references.every((component) => component !== null)) return empty;

  const rows = await db
    .select()
    .from(foodNutrients)
    .where(
      inArray(
        foodNutrients.foodId,
        references.map(({ foodId }) => foodId)
      )
    );
  const byFood = Map.groupBy(rows, ({ foodId }) => foodId);
  const components = references.map(({ foodId, percent }) => ({
    percent,
    nutrients: Object.fromEntries(
      (byFood.get(foodId) ?? []).map(({ nutrientId, amount }) => [nutrientId, amount])
    )
  }));
  const estimates = estimateIngredientNutrients(
    documented,
    components,
    record.evidence.orderedByWeight
  );
  return { documented, estimates };
}
