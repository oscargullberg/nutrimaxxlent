import { and, desc, eq, exists, gte, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { goals, logEntries, logEntryItems, logItemNutrients, profiles } from '../db/schema.ts';
import type { NutrientId } from '../../nutrition-reference.ts';
import { dailyIntakeReferences } from '../nutrition/references/index.ts';
import { aggregateDaily, type NutrientSnapshot } from '../nutrition/snapshots.ts';
import { sumDietary, unknownDietary, type DietaryAmounts } from '../nutrition/dietary.ts';

export async function getProfile(db: Pick<Database, 'select'>) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, 1));
  if (!profile) throw new Error('Default profile is missing. Run pnpm db:seed.');
  return profile;
}

export function localDay(date: string, timezone: string) {
  return sql`${logEntries.loggedAt} >= (${date}::date::timestamp AT TIME ZONE ${timezone})
    AND ${logEntries.loggedAt} < ((${date}::date + 1)::timestamp AT TIME ZONE ${timezone})`;
}

export async function recentMeals(
  db: Database,
  profile: { id: number; timezone: string },
  { days = 7, date, limit = 8 }: { days?: number; date?: string; limit?: number } = {}
) {
  const activeItems = db
    .select({ id: logEntryItems.id })
    .from(logEntryItems)
    .where(and(eq(logEntryItems.entryId, logEntries.id), isNull(logEntryItems.removedAt)));
  const meals = db
    .select({
      id: logEntries.id,
      title: logEntries.title,
      meal: logEntries.meal,
      loggedAt: logEntries.loggedAt
    })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.profileId, profile.id),
        eq(logEntries.status, 'active'),
        exists(activeItems),
        date
          ? localDay(date, profile.timezone)
          : gte(logEntries.loggedAt, new Date(Date.now() - days * 86_400_000))
      )
    )
    .orderBy(desc(logEntries.loggedAt), desc(logEntries.id))
    .limit(limit)
    .as('recent_meals');
  const rows = await db
    .select({
      id: meals.id,
      title: meals.title,
      meal: meals.meal,
      loggedAt: meals.loggedAt,
      item: {
        label: logEntryItems.label,
        foodId: logEntryItems.foodId,
        recipeId: logEntryItems.recipeId,
        grams: logEntryItems.grams,
        quantity: logEntryItems.quantity,
        unit: logEntryItems.unit,
        adjustments: sql<unknown[] | null>`${logEntryItems.resolution}->'adjustments'`
      }
    })
    .from(meals)
    .innerJoin(
      logEntryItems,
      and(eq(logEntryItems.entryId, meals.id), isNull(logEntryItems.removedAt))
    )
    .orderBy(desc(meals.loggedAt), desc(meals.id), logEntryItems.id);
  return Array.from(Map.groupBy(rows, ({ id }) => id).values(), (group) => {
    const { item: _item, ...meal } = group[0]!;
    return {
      ...meal,
      items: group.map(({ item: { adjustments, ...item } }) => ({
        ...item,
        ...(adjustments?.length ? { adjustments } : {})
      }))
    };
  });
}

export async function dayTotals(db: Database, date: string) {
  const profile = await getProfile(db);
  const [rows, targets] = await Promise.all([
    db
      .select({
        entry: logEntries,
        itemId: logEntryItems.id,
        grams: logEntryItems.grams,
        dietary: logEntryItems.dietary,
        nutrient: logItemNutrients
      })
      .from(logEntries)
      .innerJoin(
        logEntryItems,
        and(eq(logEntryItems.entryId, logEntries.id), isNull(logEntryItems.removedAt))
      )
      .leftJoin(logItemNutrients, eq(logItemNutrients.itemId, logEntryItems.id))
      .where(
        and(
          eq(logEntries.profileId, profile.id),
          eq(logEntries.status, 'active'),
          localDay(date, profile.timezone)
        )
      )
      .orderBy(logEntries.loggedAt),
    db
      .select()
      .from(goals)
      .where(sql`${goals.profileId} = ${profile.id} AND ${goals.effectiveFrom} <= ${date}::date`)
      .orderBy(desc(goals.effectiveFrom))
      .limit(1)
  ]);
  const byEntry = new Map<
    string,
    (typeof rows)[number]['entry'] & { snapshots: NutrientSnapshot[] }
  >();
  const dietaryByItem = new Map<string, DietaryAmounts>();
  const knownItems: Partial<Record<NutrientId, number>> = {};
  const estimatedTotals: Partial<Record<NutrientId, number>> = {};
  for (const { entry, itemId, grams, dietary, nutrient } of rows) {
    const value = byEntry.get(entry.id) ?? { ...entry, snapshots: [] };
    if (!dietaryByItem.has(itemId)) {
      dietaryByItem.set(itemId, dietary ?? unknownDietary(grams));
    }
    if (nutrient) {
      const id = nutrient.nutrientId as NutrientId;
      value.snapshots.push({ ...nutrient, nutrientId: id });
      if (nutrient.amount !== null) {
        knownItems[id] = (knownItems[id] ?? 0) + 1;
        if (nutrient.isEstimate) estimatedTotals[id] = (estimatedTotals[id] ?? 0) + nutrient.amount;
      }
    }
    byEntry.set(entry.id, value);
  }
  const aggregated = aggregateDaily([...byEntry.values()], date, profile.timezone);
  const effective = targets[0] ?? null;
  const comparison = {
    energy_kcal: {
      consumed: aggregated.totals.energy_kcal ?? null,
      target: effective?.kcal ?? null
    },
    protein_g: {
      consumed: aggregated.totals.protein_g ?? null,
      target: effective?.proteinG ?? null
    },
    fat_g: { consumed: aggregated.totals.fat_g ?? null, target: effective?.fatG ?? null },
    carbs_g: { consumed: aggregated.totals.carbs_g ?? null, target: effective?.carbsG ?? null },
    fiber_g: { consumed: aggregated.totals.fiber_g ?? null, target: effective?.fiberG ?? null }
  };
  return {
    ...aggregated,
    goals: effective,
    comparison,
    intake: dailyIntakeReferences(effective),
    dietary: sumDietary([...dietaryByItem.values()]),
    estimatedTotals,
    coverage: { items: dietaryByItem.size, knownItems }
  };
}

export async function rangeTotals(db: Database, from: string, to: string) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    throw new RangeError('Choose a range of 1 to 31 days.');
  }
  return Promise.all(
    Array.from({ length: days }, (_, index) => {
      const day = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      return dayTotals(db, day);
    })
  );
}
