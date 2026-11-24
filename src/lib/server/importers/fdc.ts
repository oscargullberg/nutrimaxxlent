import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { normalizeUnit } from '../nutrition/amounts.ts';
import { canonicalNutrients, type NutrientId } from '../../nutrition-reference.ts';
import { fdcFoodGroups, type FdcDietaryFood } from './fdc-dietary.ts';
import type { FoodSourceAdapter, SourceFood } from './source.ts';

export const fdcDatasets = [
  {
    file: 'foundation',
    key: 'FoundationFoods',
    archive: 'FoodData_Central_foundation_food_json_2026-10-29.zip'
  },
  {
    file: 'sr-legacy',
    key: 'SRLegacyFoods',
    archive: 'FoodData_Central_sr_legacy_food_json_2018-04.zip'
  },
  { file: 'fndds', key: 'SurveyFoods', archive: 'FoodData_Central_survey_food_json_2024-10-31.zip' }
] as const;

const fdcSource = {
  id: 'fdc',
  name: 'USDA FoodData Central',
  license: 'CC0 1.0',
  attribution: 'USDA Agricultural Research Service, FoodData Central',
  homepage: 'https://fdc.nal.usda.gov/'
};

const portionSchema = z.object({
  gramWeight: z.number().nullish(),
  amount: z.number().nullish(),
  modifier: z.string().nullish(),
  sequenceNumber: z.number().nullish(),
  portionDescription: z.string().nullish(),
  measureUnit: z
    .object({ name: z.string().nullish(), abbreviation: z.string().nullish() })
    .nullish()
});
const foodSchema = z.object({
  fdcId: z.number().int(),
  ndbNumber: z.number().int().nullish(),
  description: z.string().min(1),
  foodCategory: z.object({ description: z.string().nullish() }).nullish(),
  wweiaFoodCategory: z.object({ wweiaFoodCategoryDescription: z.string().nullish() }).nullish(),
  foodNutrients: z.array(
    z.object({
      amount: z.number().nullish(),
      nutrient: z.object({ number: z.string(), name: z.string(), unitName: z.string() }),
      foodNutrientDerivation: z.object({ code: z.string().nullish() }).nullish()
    })
  ),
  foodPortions: z.array(portionSchema).optional()
});
const surveyFoodSchema = foodSchema.extend({
  foodCode: z.string().regex(/^\d+$/u).nullish(),
  foodAttributes: z
    .array(
      z.object({
        value: z.unknown(),
        foodAttributeType: z.object({ id: z.number() }).nullish()
      })
    )
    .optional(),
  inputFoods: z
    .array(
      z.object({
        ingredientCode: z.number().int(),
        ingredientDescription: z.string().min(1),
        ingredientWeight: z.number().nonnegative().nullish(),
        sequenceNumber: z.number().int()
      })
    )
    .optional()
});

function surveyRecipe(food: z.infer<typeof surveyFoodSchema>) {
  const adjustment = food.foodAttributes?.find((item) => item.foodAttributeType?.id === 1002);
  const moisture =
    typeof adjustment?.value === 'string'
      ? adjustment.value.match(/^Moisture change: (-?\d+(?:\.\d+)?)%$/u)?.[1]
      : undefined;
  return {
    ingredients: food.inputFoods
      ?.toSorted((first, second) => first.sequenceNumber - second.sequenceNumber)
      .map((item) => ({
        code: item.ingredientCode,
        name: item.ingredientDescription,
        grams: item.ingredientWeight ?? null
      })),
    moistureChange: moisture === undefined ? undefined : Number(moisture)
  };
}

const nutrientCodes: Readonly<Record<string, NutrientId>> = {
  '208': 'energy_kcal',
  '958': 'energy_kcal',
  '957': 'energy_kcal',
  '268': 'energy_kj',
  '203': 'protein_g',
  '204': 'fat_g',
  '606': 'saturated_fat_g',
  '205': 'carbs_g',
  '269': 'sugars_g',
  '291': 'fiber_g',
  '307': 'sodium_mg',
  '306': 'potassium_mg',
  '301': 'calcium_mg',
  '303': 'iron_mg',
  '401': 'vitamin_c_mg',
  '328': 'vitamin_d_ug',
  '539': 'added_sugars_g',
  '645': 'monounsaturated_fat_g',
  '646': 'polyunsaturated_fat_g',
  '605': 'trans_fat_g',
  '851': 'omega3_ala_g',
  '629': 'omega3_epa_mg',
  '621': 'omega3_dha_mg',
  '675': 'omega6_la_g',
  '320': 'vitamin_a_ug_rae',
  '404': 'vitamin_b1_mg',
  '405': 'vitamin_b2_mg',
  '406': 'vitamin_b3_mg',
  '410': 'vitamin_b5_mg',
  '415': 'vitamin_b6_mg',
  '416': 'vitamin_b7_ug',
  '417': 'vitamin_b9_ug',
  '418': 'vitamin_b12_ug',
  '323': 'vitamin_e_mg',
  '430': 'vitamin_k_ug',
  '304': 'magnesium_mg',
  '305': 'phosphorus_mg',
  '309': 'zinc_mg',
  '317': 'selenium_ug',
  '314': 'iodine_ug',
  '312': 'copper_mg',
  '315': 'manganese_mg'
};
const canonical = new Map(canonicalNutrients.map((item) => [item.id, item]));
const energyPriority = ['208', '958', '957'];

function getNutrients(food: z.infer<typeof foodSchema>) {
  const found = new Map<NutrientId, SourceFood['nutrients'][number]>();
  for (const { amount, nutrient, foodNutrientDerivation } of food.foodNutrients) {
    const id = nutrientCodes[nutrient.number];
    const definition = id ? canonical.get(id) : undefined;
    if (!definition || !id) continue;
    const fattyAcidInGrams = id === 'omega3_epa_mg' || id === 'omega3_dha_mg';
    const sourceUnit = fattyAcidInGrams ? 'g' : id === 'vitamin_a_ug_rae' ? 'µg' : definition.unit;
    if (nutrient.unitName.toLowerCase() !== sourceUnit.toLowerCase()) continue;
    const existing = found.get(id);
    if (existing?.amount != null) {
      const previousCode = existing.sourceMeta?.code;
      if (
        id !== 'energy_kcal' ||
        amount == null ||
        energyPriority.indexOf(String(previousCode)) <= energyPriority.indexOf(nutrient.number)
      )
        continue;
    }
    found.set(id, {
      nutrientId: id,
      amount: amount != null && amount >= 0 ? amount * (fattyAcidInGrams ? 1000 : 1) : null,
      unit: definition.unit,
      isDerived: nutrient.number === '957' || nutrient.number === '958',
      sourceMeta: {
        code: nutrient.number,
        name: nutrient.name,
        derivationCode: foodNutrientDerivation?.code
      }
    });
  }
  const sodium = found.get('sodium_mg')?.amount;
  if (sodium != null) {
    found.set('salt_g', {
      nutrientId: 'salt_g',
      amount: (sodium * 2.5) / 1000,
      unit: 'g',
      isDerived: true
    });
  }
  return [...found.values()];
}

function parseQuantity(value: string) {
  return value.split(' ').reduce((sum, part) => {
    const [numerator, denominator] = part.split('/').map(Number);
    return sum + (numerator ?? 0) / (denominator ?? 1);
  }, 0);
}

function getPortions(food: z.infer<typeof foodSchema>) {
  const portions = (food.foodPortions ?? []).toSorted(
    (a, b) => (a.sequenceNumber ?? Infinity) - (b.sequenceNumber ?? Infinity)
  );
  return portions
    .flatMap((portion) => {
      const grams = portion.gramWeight;
      if (!grams || grams <= 0) return [];
      const description = portion.portionDescription?.trim();
      const parsed = description?.match(/^(\d+ \d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/u);
      const unitName = portion.measureUnit?.name?.trim();
      const knownUnit =
        unitName && !['undetermined', 'racc'].includes(unitName.toLowerCase())
          ? unitName
          : undefined;
      const label =
        description ??
        [
          portion.amount && portion.amount !== 1 ? portion.amount : null,
          knownUnit ?? unitName,
          portion.modifier
        ]
          .filter(Boolean)
          .join(' ');
      if (!label || /^quantity not specified|^guideline amount/iu.test(label)) return [];
      const quantity = parsed?.[1] ? parseQuantity(parsed[1]) : (portion.amount ?? 1);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      const unit = normalizeUnit(knownUnit ?? parsed?.[2] ?? label);
      if (quantity === 1) return [{ label, unit, grams, isDefault: false }];
      return [
        { label, unit: 'portion', grams, isDefault: false },
        { label: `1 ${unit}`, unit, grams: grams / quantity, isDefault: false }
      ];
    })
    .map((portion, index) => ({ ...portion, isDefault: index === 0 }));
}

export async function fdcAdapter(dataDir: string): Promise<FoodSourceAdapter> {
  const datasets = await Promise.all(
    fdcDatasets.map(async ({ file, key }) => {
      const raw = await readFile(join(dataDir, 'fdc', `${file}.json`), 'utf8');
      const revision = createHash('sha256').update('fdc-dietary-v1:').update(raw).digest('hex');
      return { file, key, raw, revision };
    })
  );
  const version = createHash('sha256')
    .update(datasets.map((dataset) => dataset.revision).join(':'))
    .digest('hex');
  return {
    source: fdcSource,
    version: `fdc-${version.slice(0, 20)}`,
    async *records() {
      const records = datasets.flatMap(({ file, key, raw, revision }) => {
        const rows =
          z.object({ [key]: z.array(z.unknown()) }).parse(JSON.parse(raw) as unknown)[key] ?? [];
        return rows.map((input) => {
          const survey = file === 'fndds' ? surveyFoodSchema.parse(input) : null;
          const food = survey ?? foodSchema.parse(input);
          const dietaryFood: FdcDietaryFood = {
            id: String(food.fdcId),
            name: food.description,
            category:
              food.foodCategory?.description ??
              food.wweiaFoodCategory?.wweiaFoodCategoryDescription ??
              undefined,
            ...(survey ? surveyRecipe(survey) : {})
          };
          const code = survey?.foodCode ? Number(survey.foodCode) : food.ndbNumber;
          return { food, file, code, dietaryFood, revision };
        });
      });
      const byCode = new Map<number, FdcDietaryFood[]>();
      for (const { code, dietaryFood } of records) {
        if (code == null) continue;
        const candidates = byCode.get(code) ?? [];
        candidates.push(dietaryFood);
        byCode.set(code, candidates);
      }
      for (const { food, file, code, dietaryFood, revision } of records) {
        const { components, ...dietary } = fdcFoodGroups(dietaryFood, byCode);
        yield {
          id: dietaryFood.id,
          revision: file === 'fndds' ? version : revision,
          kind: 'generic',
          name: dietaryFood.name,
          nameEn: dietaryFood.name,
          category: dietaryFood.category,
          classification: { dataset: file, ...(code == null ? {} : { code }), ...dietary },
          components,
          nutrients: getNutrients(food),
          portions: getPortions(food)
        };
      }
    }
  };
}
