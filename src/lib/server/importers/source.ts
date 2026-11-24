import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import {
  datasetRuns,
  foodAliases,
  foodComponents,
  foodNutrients,
  foods,
  foodSources,
  portions
} from '../db/schema.ts';
import type { Portion } from '../nutrition/amounts.ts';
import type { CatalogClassification } from '../nutrition/dietary.ts';
import type { NutrientId } from '../../nutrition-reference.ts';

export type SourceFood = {
  id: string;
  name: string;
  revision?: string;
  nameEn?: string;
  kind: (typeof foods.$inferInsert)['kind'];
  category?: string;
  classification?: CatalogClassification;
  brand?: string;
  barcode?: string;
  densityGPerMl?: number;
  nutrients: {
    nutrientId: NutrientId;
    amount: number | null;
    unit: string;
    isDerived?: boolean;
    sourceMeta?: Record<string, unknown>;
  }[];
  portions?: readonly Omit<Portion, 'source'>[];
  aliases?: readonly { alias: string; language?: string }[];
  components?: readonly {
    foodId?: string;
    name: string;
    amountG?: number;
    rawAmountG?: number;
    depth: number;
  }[];
};

export type FoodSourceAdapter = {
  source: Pick<
    typeof foodSources.$inferInsert,
    'id' | 'name' | 'license' | 'attribution' | 'homepage'
  >;
  version: string;
  records(): AsyncIterable<SourceFood>;
};

export function normalizeSearch(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/gu, ' ');
}

export async function runImport(
  db: Database,
  adapter: FoodSourceAdapter,
  onProgress?: (
    stats: Readonly<{ read: number; inserted: number; updated: number; unchanged: number }>
  ) => void
) {
  const { source, version } = adapter;
  const stats = { read: 0, inserted: 0, updated: 0, unchanged: 0 };

  await db.insert(foodSources).values(source).onConflictDoNothing();
  const [run] = await db
    .insert(datasetRuns)
    .values({ sourceId: source.id, version })
    .returning({ id: datasetRuns.id });
  if (!run) throw new Error('Could not create dataset run.');

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${source.id}))`);
      const pendingComponents = new Map<string, NonNullable<SourceFood['components']>>();
      for await (const record of adapter.records()) {
        stats.read++;
        const identity = and(eq(foods.sourceId, source.id), eq(foods.sourceFoodId, record.id));
        const [existing] = await tx
          .select({ id: foods.id, version: foods.sourceVersion })
          .from(foods)
          .where(identity);
        const sourceVersion = record.revision ?? version;
        if (existing?.version === sourceVersion) {
          stats.unchanged++;
        } else {
          const values = {
            kind: record.kind,
            name: record.name,
            nameEn: record.nameEn ?? null,
            brand: record.brand ?? null,
            barcode: record.barcode ?? null,
            category: record.category ?? null,
            classification: record.classification ?? null,
            densityGPerMl: record.densityGPerMl ?? null,
            sourceVersion,
            searchText: normalizeSearch(
              [record.name, record.nameEn, record.brand].filter(Boolean).join(' ')
            )
          };
          const [food] = await tx
            .insert(foods)
            .values({ ...values, sourceId: source.id, sourceFoodId: record.id })
            .onConflictDoUpdate({ target: [foods.sourceId, foods.sourceFoodId], set: values })
            .returning({ id: foods.id });
          if (!food) throw new Error(`Could not write source food ${record.id}.`);

          await tx.delete(foodNutrients).where(eq(foodNutrients.foodId, food.id));
          await tx
            .delete(portions)
            .where(and(eq(portions.foodId, food.id), eq(portions.source, source.id)));
          await tx
            .delete(foodAliases)
            .where(and(eq(foodAliases.foodId, food.id), eq(foodAliases.source, source.id)));
          if (record.nutrients.length) {
            await tx
              .insert(foodNutrients)
              .values(record.nutrients.map((nutrient) => ({ ...nutrient, foodId: food.id })));
          }
          if (record.portions?.length) {
            await tx
              .insert(portions)
              .values(
                record.portions.map((portion) => ({
                  ...portion,
                  foodId: food.id,
                  source: source.id
                }))
              )
              .onConflictDoNothing();
          }
          if (record.aliases?.length) {
            await tx
              .insert(foodAliases)
              .values(
                record.aliases.map((alias) => ({
                  ...alias,
                  alias: normalizeSearch(alias.alias),
                  foodId: food.id,
                  source: source.id
                }))
              )
              .onConflictDoNothing();
          }
          if (record.components?.length) pendingComponents.set(food.id, record.components);
          else await tx.delete(foodComponents).where(eq(foodComponents.parentFoodId, food.id));
          if (existing) stats.updated++;
          else stats.inserted++;
        }
        if (stats.read % 100 === 0) onProgress?.({ ...stats });
      }

      for (const [parentFoodId, components] of pendingComponents) {
        const sourceIds = components.flatMap((component) =>
          component.foodId ? [component.foodId] : []
        );
        const children = sourceIds.length
          ? await tx
              .select({ id: foods.id, sourceFoodId: foods.sourceFoodId })
              .from(foods)
              .where(and(eq(foods.sourceId, source.id), inArray(foods.sourceFoodId, sourceIds)))
          : [];
        const childIds = new Map(children.map((child) => [child.sourceFoodId, child.id]));
        const rows = components.map((component, sortOrder) => ({
          name: component.name,
          amountG: component.amountG ?? null,
          rawAmountG: component.rawAmountG ?? null,
          depth: component.depth,
          childFoodId: (component.foodId && childIds.get(component.foodId)) || null,
          parentFoodId,
          sortOrder
        }));
        const previous = await tx
          .select()
          .from(foodComponents)
          .where(eq(foodComponents.parentFoodId, parentFoodId))
          .orderBy(foodComponents.sortOrder);
        // Saved dish adjustments refer to these component IDs.
        if (
          previous.length === rows.length &&
          previous.every((row, index) => {
            const next = rows[index]!;
            return (
              row.name === next.name &&
              row.amountG === next.amountG &&
              row.rawAmountG === next.rawAmountG &&
              row.depth === next.depth &&
              row.childFoodId === next.childFoodId &&
              row.sortOrder === next.sortOrder
            );
          })
        )
          continue;
        await tx.delete(foodComponents).where(eq(foodComponents.parentFoodId, parentFoodId));
        await tx.insert(foodComponents).values(rows);
      }

      const finishedAt = new Date();
      await tx
        .update(foodSources)
        .set({ ...source, version, lastImportedAt: finishedAt })
        .where(eq(foodSources.id, source.id));
      await tx
        .update(datasetRuns)
        .set({ status: 'complete', finishedAt, stats })
        .where(eq(datasetRuns.id, run.id));
    });
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(datasetRuns)
      .set({ status: 'failed', finishedAt: new Date(), stats, error: message.slice(0, 2000) })
      .where(eq(datasetRuns.id, run.id));
    throw error;
  }
}
