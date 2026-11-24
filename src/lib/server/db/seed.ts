import { canonicalNutrients, standardUnits } from '../../nutrition-reference.ts';
import type { Database } from './client.ts';
import {
  foodAliases,
  foodNutrients,
  foodSources,
  foods,
  goals,
  nutrients,
  profiles,
  unitConversions
} from './schema.ts';

const coreNutrients = new Set(['energy_kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g']);

export async function seedDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx
      .insert(nutrients)
      .values(
        canonicalNutrients.map((nutrient, index) => ({
          ...nutrient,
          displayOrder: index,
          isCore: coreNutrients.has(nutrient.id)
        }))
      )
      .onConflictDoNothing();
    await tx
      .insert(unitConversions)
      .values([...standardUnits])
      .onConflictDoNothing();
    await tx.insert(profiles).values({ id: 1 }).onConflictDoNothing();
    await tx
      .insert(goals)
      .values({ profileId: 1, effectiveFrom: '0001-01-01' })
      .onConflictDoNothing();

    const labelUrl = 'https://www.frodinge.se/alla-produkter/frodinge-ostkaka-300g/';
    await tx
      .insert(foodSources)
      .values({
        id: 'frodinge',
        name: 'Frödinge',
        license: 'Manufacturer nutrition declaration',
        attribution: 'Frödinge',
        homepage: labelUrl
      })
      .onConflictDoNothing();
    const [ostkaka] = await tx
      .insert(foods)
      .values({
        sourceId: 'frodinge',
        sourceFoodId: 'ostkaka-300g',
        sourceVersion: '1',
        kind: 'branded',
        name: 'Frödinge Ostkaka',
        brand: 'Frödinge',
        searchText: 'frodinge ostkaka'
      })
      .onConflictDoUpdate({
        target: [foods.sourceId, foods.sourceFoodId],
        set: { searchText: 'frodinge ostkaka' }
      })
      .returning({ id: foods.id });
    if (!ostkaka) throw new Error('Could not seed Frödinge Ostkaka.');
    await tx
      .insert(foodAliases)
      .values(
        ['ostkaka frodinge', 'frodinge ostkaka'].map((alias) => ({
          foodId: ostkaka.id,
          alias,
          language: 'sv',
          source: 'frodinge'
        }))
      )
      .onConflictDoNothing();
    const labelValues: Partial<Record<(typeof canonicalNutrients)[number]['id'], number>> = {
      energy_kcal: 170,
      energy_kj: 700,
      protein_g: 10,
      carbs_g: 16,
      sugars_g: 10,
      fat_g: 7,
      saturated_fat_g: 4,
      salt_g: 0.12
    };
    await tx
      .insert(foodNutrients)
      .values(
        canonicalNutrients.flatMap(({ id, unit }) => {
          const amount = labelValues[id];
          return amount === undefined
            ? []
            : [{ foodId: ostkaka.id, nutrientId: id, amount, unit, sourceMeta: { url: labelUrl } }];
        })
      )
      .onConflictDoNothing();
  });
}
