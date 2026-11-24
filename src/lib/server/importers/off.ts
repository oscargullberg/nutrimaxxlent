import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { NutrientId } from '../../nutrition-reference.ts';
import { novaGroups } from '../../food-groups.ts';
import { unknownDietary, withNova } from '../nutrition/dietary.ts';
import { brandAliases } from './brand-aliases.ts';
import type { FoodSourceAdapter, SourceFood } from './source.ts';

export const offParquetUrl =
  'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet';

const offSource = {
  id: 'off',
  name: 'Open Food Facts',
  license: 'ODbL 1.0',
  attribution: 'Open Food Facts contributors',
  homepage: 'https://world.openfoodfacts.org/'
};

const rowSchema = z.object({
  barcode: z.string().regex(/^\d{4,24}$/u),
  name: z.string().trim().min(1),
  name_en: z.string().nullish(),
  brand: z.string().nullish(),
  quantity: z.string().nullish(),
  serving_size: z.string().nullish(),
  nova_group: z.number().int().nullish(),
  nutrients: z.array(z.object({ name: z.string(), '100g': z.number().nonnegative() })).min(1)
});

const offNutrients: Readonly<Partial<Record<string, readonly [NutrientId, string, number]>>> = {
  'energy-kcal': ['energy_kcal', 'kcal', 1],
  'energy-kj': ['energy_kj', 'kJ', 1],
  proteins: ['protein_g', 'g', 1],
  fat: ['fat_g', 'g', 1],
  'saturated-fat': ['saturated_fat_g', 'g', 1],
  carbohydrates: ['carbs_g', 'g', 1],
  sugars: ['sugars_g', 'g', 1],
  fiber: ['fiber_g', 'g', 1],
  salt: ['salt_g', 'g', 1],
  sodium: ['sodium_mg', 'mg', 1000],
  potassium: ['potassium_mg', 'mg', 1000],
  calcium: ['calcium_mg', 'mg', 1000],
  iron: ['iron_mg', 'mg', 1000],
  'vitamin-c': ['vitamin_c_mg', 'mg', 1000],
  'vitamin-d': ['vitamin_d_ug', 'µg', 1_000_000],
  'monounsaturated-fat': ['monounsaturated_fat_g', 'g', 1],
  'polyunsaturated-fat': ['polyunsaturated_fat_g', 'g', 1],
  'trans-fat': ['trans_fat_g', 'g', 1],
  'alpha-linolenic-acid': ['omega3_ala_g', 'g', 1],
  'eicosapentaenoic-acid': ['omega3_epa_mg', 'mg', 1000],
  'docosahexaenoic-acid': ['omega3_dha_mg', 'mg', 1000],
  'linoleic-acid': ['omega6_la_g', 'g', 1],
  'added-sugars': ['added_sugars_g', 'g', 1],
  'vitamin-b1': ['vitamin_b1_mg', 'mg', 1000],
  'vitamin-b2': ['vitamin_b2_mg', 'mg', 1000],
  'vitamin-pp': ['vitamin_b3_mg', 'mg', 1000],
  'pantothenic-acid': ['vitamin_b5_mg', 'mg', 1000],
  'vitamin-b6': ['vitamin_b6_mg', 'mg', 1000],
  biotin: ['vitamin_b7_ug', 'µg', 1000000],
  'vitamin-b12': ['vitamin_b12_ug', 'µg', 1000000],
  'vitamin-e': ['vitamin_e_mg', 'mg', 1000],
  'vitamin-k': ['vitamin_k_ug', 'µg', 1000000],
  magnesium: ['magnesium_mg', 'mg', 1000],
  phosphorus: ['phosphorus_mg', 'mg', 1000],
  zinc: ['zinc_mg', 'mg', 1000],
  selenium: ['selenium_ug', 'µg', 1000000],
  iodine: ['iodine_ug', 'µg', 1000000],
  copper: ['copper_mg', 'mg', 1000],
  manganese: ['manganese_mg', 'mg', 1000]
};

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function prefilterOff(dataDir: string, input = join(dataDir, 'off', 'food.parquet')) {
  const directory = join(dataDir, 'off');
  await mkdir(directory, { recursive: true });
  const output = join(directory, 'sweden.ndjson');
  const temporary = `${output}.${randomUUID()}.tmp`;
  const query = await readFile(
    new URL('../../../../scripts/sql/off-prefilter.sql', import.meta.url),
    'utf8'
  );
  const variables = `SET VARIABLE input_path = ${sqlString(resolve(input))};
SET VARIABLE output_path = ${sqlString(resolve(temporary))};\n`;
  try {
    await promisify(execFile)('duckdb', ['-batch', '-bail', '-c', variables + query]);
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return output;
}

export async function offAdapter(dataDir: string): Promise<FoodSourceAdapter> {
  const path = join(dataDir, 'off', 'sweden.ndjson');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {
    source: offSource,
    version: `off-${hash.digest('hex').slice(0, 20)}`,
    async *records() {
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        const row = rowSchema.parse(JSON.parse(line) as unknown);
        const nutrients = new Map<NutrientId, SourceFood['nutrients'][number]>();
        for (const item of row.nutrients) {
          const mapping = Object.hasOwn(offNutrients, item.name)
            ? offNutrients[item.name]
            : undefined;
          if (!mapping) continue;
          const [nutrientId, unit, factor] = mapping;
          nutrients.set(nutrientId, {
            nutrientId,
            unit,
            amount: item['100g'] * factor,
            sourceMeta: { name: item.name, per100g: item['100g'] }
          });
        }
        const sodium = nutrients.get('sodium_mg')?.amount;
        if (!nutrients.has('salt_g') && sodium != null) {
          nutrients.set('salt_g', {
            nutrientId: 'salt_g',
            amount: (sodium * 2.5) / 1000,
            unit: 'g',
            isDerived: true
          });
        }
        const serving = row.serving_size?.match(/(?:^|\W)(\d+(?:[.,]\d+)?)\s*g(?:\W|$)/iu)?.[1];
        const grams = serving ? Number(serving.replace(',', '.')) : 0;
        const novaGroup = novaGroups.find((group) => group === row.nova_group);
        yield {
          id: row.barcode,
          revision: createHash('sha256').update('off-nutrients-v2:').update(line).digest('hex'),
          kind: 'branded',
          name: row.name,
          nameEn: row.name_en ?? undefined,
          brand: row.brand ?? undefined,
          aliases: brandAliases(row.brand),
          barcode: row.barcode,
          classification: {
            quantity: row.quantity,
            ...(novaGroup && {
              dietary: withNova(unknownDietary(100), 100, novaGroup, offSource.name)
            })
          },
          nutrients: [...nutrients.values()],
          portions:
            grams > 0 ? [{ label: row.serving_size!, unit: 'portion', grams, isDefault: true }] : []
        };
      }
    }
  };
}
