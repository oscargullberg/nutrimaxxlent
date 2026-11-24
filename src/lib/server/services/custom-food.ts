import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { foodNutrients, foodSources, foods, portions } from '../db/schema.ts';
import { normalizeSearch } from '../importers/source.ts';
import { canonicalNutrients, portionUnitName } from '../../nutrition-reference.ts';
import { lookupPortionUnit } from '../nutrition/amounts.ts';
import { getFood } from './catalog.ts';

const goalNutrients = z.enum(canonicalNutrients.map(({ id }) => id));
export const newFoodInput = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(100).optional(),
  barcode: z
    .string()
    .regex(/^\d{4,24}$/u)
    .optional(),
  category: z.string().trim().max(100).optional(),
  per100g: z
    .partialRecord(goalNutrients, z.number().nonnegative())
    .refine((values) => Object.keys(values).length > 0),
  portionG: z.number().positive().optional(),
  densityGPerMl: z.number().positive().optional()
});
export const foodSettings = z.object({
  favorite: z.boolean().optional(),
  portionG: z.number().positive().nullable().optional(),
  portionUnit: z
    .string()
    .refine((unit) => lookupPortionUnit(unit) === unit)
    .optional()
});

export async function addCustomFood(db: Database, input: z.input<typeof newFoodInput>) {
  const fields = newFoodInput.parse(input);
  const id = await db.transaction(async (tx) => {
    await tx
      .insert(foodSources)
      .values({
        id: 'user',
        name: 'My foods',
        license: 'User-provided',
        attribution: 'Local user',
        homepage: ''
      })
      .onConflictDoNothing();
    const [food] = await tx
      .insert(foods)
      .values({
        sourceId: 'user',
        sourceFoodId: crypto.randomUUID(),
        sourceVersion: '1',
        kind: 'custom',
        name: fields.name,
        brand: fields.brand,
        barcode: fields.barcode,
        category: fields.category,
        densityGPerMl: fields.densityGPerMl,
        searchText: normalizeSearch([fields.name, fields.brand].filter(Boolean).join(' '))
      })
      .returning({ id: foods.id });
    if (!food) throw new Error('Could not save food.');
    const nutrientRows = canonicalNutrients.flatMap(({ id, unit }) => {
      const amount = fields.per100g[id];
      return amount === undefined ? [] : [{ foodId: food.id, nutrientId: id, unit, amount }];
    });
    await tx.insert(foodNutrients).values(nutrientRows);
    if (fields.portionG !== undefined) {
      await tx.insert(portions).values({
        foodId: food.id,
        grams: fields.portionG,
        unit: 'portion',
        label: 'My serving',
        isDefault: true,
        source: 'user'
      });
    }
    return food.id;
  });
  return getFood(db, id);
}

export async function updateFoodSettings(
  db: Database,
  foodId: string,
  input: z.input<typeof foodSettings>
) {
  const fields = foodSettings.parse(input);
  return db.transaction(async (tx) => {
    const [food] = await tx.select().from(foods).where(eq(foods.id, foodId)).for('update');
    if (!food) return null;
    if (fields.favorite !== undefined)
      await tx.update(foods).set({ favorite: fields.favorite }).where(eq(foods.id, foodId));
    if (fields.portionG !== undefined) {
      const unit = fields.portionUnit ?? 'portion';
      await tx
        .delete(portions)
        .where(
          and(eq(portions.foodId, foodId), eq(portions.source, 'user'), eq(portions.unit, unit))
        );
      if (fields.portionG !== null) {
        await tx.insert(portions).values({
          foodId,
          grams: fields.portionG,
          unit,
          label: `My ${portionUnitName(unit)}`,
          isDefault: unit === 'portion',
          source: 'user'
        });
      }
    }
    return getFood(tx, foodId);
  });
}
