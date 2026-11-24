import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { canonicalNutrients } from '../../nutrition-reference.ts';
import {
  scaleDietary,
  sumDietary,
  unknownDietary,
  withNova,
  type CatalogClassification
} from '../nutrition/dietary.ts';
import { classifySlvLeaf, slvFacet } from './slv-dietary.ts';
import type { FoodSourceAdapter, SourceFood } from './source.ts';

const api = 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1';
export const slvSource = {
  id: 'slv',
  name: 'Livsmedelsverket',
  license: 'CC BY 4.0',
  attribution: 'Swedish Food Agency, Swedish Food Composition Database',
  homepage: 'https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data'
};

const food = z.object({
  nummer: z.number().int(),
  namn: z.string().min(1),
  version: z.string().min(1),
  livsmedelsTypId: z.number().int(),
  links: z.array(z.object({ rel: z.string() }))
});
const foodList = z.object({
  livsmedel: z.array(food),
  _meta: z.object({ totalRecords: z.number().int().positive() })
});
const nutrient = z.looseObject({
  euroFIRkod: z.string().nullish(),
  enhet: z.string(),
  varde: z.number().nullish(),
  viktGram: z.number().nullish()
});
const classification = z.looseObject({
  namn: z.string().nullish(),
  fasett: z.string().nullish()
});
const ingredient = z.object({
  nummer: z.number().int(),
  namn: z.string(),
  viktForeTillagning: z.number().nonnegative().nullish(),
  viktEfterTillagning: z.number().nonnegative().nullish()
});
const rawFood = z.object({
  sv: food,
  en: z.string().optional(),
  nutrients: z.array(nutrient),
  classifications: z.array(classification),
  ingredients: z.array(ingredient)
});
const manifest = z.object({
  version: z.string(),
  files: z.array(z.string().regex(/^[0-9]+-[a-f0-9]+\.json$/u))
});
type RawFood = z.infer<typeof rawFood>;

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function writeJson(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, path);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function fetchJson(path: string, fetcher: typeof fetch): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(`${api}/${path}`, { signal: AbortSignal.timeout(20_000) });
      if (response.ok) return (await response.json()) as unknown;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`SLV ${path} returned HTTP ${response.status}.`, { cause: 'permanent' });
      }
      throw new Error(`SLV ${path} returned HTTP ${response.status}.`);
    } catch (error) {
      if (attempt >= 3 || (error instanceof Error && error.cause === 'permanent')) throw error;
      await setTimeout(250 * 2 ** attempt);
    }
  }
}

async function listFoods(language: number, fetcher: typeof fetch) {
  const foods: z.infer<typeof food>[] = [];
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = foodList.parse(
      await fetchJson(`livsmedel?offset=${offset}&limit=${limit}&sprak=${language}`, fetcher)
    );
    foods.push(...page.livsmedel);
    if (foods.length >= page._meta.totalRecords) return foods;
    if (page.livsmedel.length !== limit) throw new Error('SLV returned an incomplete food list.');
  }
}

export async function downloadSlv(
  dataDir: string,
  {
    fetcher = fetch,
    onProgress
  }: { fetcher?: typeof fetch; onProgress?: (done: number, total: number) => void } = {}
) {
  const dir = join(dataDir, 'slv');
  await mkdir(dir, { recursive: true });
  const [swedish, english] = await Promise.all([listFoods(1, fetcher), listFoods(2, fetcher)]);
  const names = new Map(english.map((item) => [item.nummer, item.namn]));
  const files: string[] = [];
  const batchSize = 4;
  for (let start = 0; start < swedish.length; start += batchSize) {
    const batch = swedish.slice(start, start + batchSize);
    files.push(
      ...(await Promise.all(
        batch.map(async (sv) => {
          const en = names.get(sv.nummer);
          const filename = `${sv.nummer}-${hash([sv.version, sv.namn, en]).slice(0, 20)}.json`;
          const path = join(dir, filename);
          try {
            rawFood.parse(await readJson(path));
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
              throw error;
            const endpoint = `livsmedel/${sv.nummer}`;
            const nutrients = await fetchJson(`${endpoint}/naringsvarden`, fetcher);
            const classifications = await fetchJson(`${endpoint}/klassificeringar`, fetcher);
            const ingredients = sv.links.some(({ rel }) => rel === 'ingredienser')
              ? await fetchJson(`${endpoint}/ingredienser`, fetcher)
              : [];
            await writeJson(
              path,
              rawFood.parse({ sv, en, nutrients, classifications, ingredients })
            );
          }
          return filename;
        })
      ))
    );
    if (files.length === swedish.length || files.length % 100 === 0)
      onProgress?.(files.length, swedish.length);
  }

  const version = `slv-${hash(files).slice(0, 20)}`;
  await writeJson(join(dir, 'manifest.json'), { version, files });
  return { version, foods: files.length };
}

const nutrientByCode = new Map<string, (typeof canonicalNutrients)[number]>(
  canonicalNutrients.flatMap((item) => {
    if (!item.eurofirCode) return [];
    // These API fields use grams for EPA/DHA and the legacy unit label for vitamin A.
    const unit =
      item.id === 'vitamin_a_ug_rae'
        ? 'RE/µg'
        : item.id === 'omega3_epa_mg' || item.id === 'omega3_dha_mg'
          ? 'g'
          : item.unit;
    return [[`${item.eurofirCode}/${unit}`, item]];
  })
);

function readNutrients(raw: RawFood) {
  const values = new Map<string, SourceFood['nutrients'][number]>();
  for (const data of raw.nutrients) {
    const match = nutrientByCode.get(`${data.euroFIRkod}/${data.enhet}`);
    if (!match || (data.viktGram != null && data.viktGram !== 100)) continue;
    const previous = values.get(match.id);
    if (previous?.amount != null) continue;
    values.set(match.id, {
      nutrientId: match.id,
      amount:
        data.varde == null
          ? null
          : data.varde * (match.id === 'omega3_epa_mg' || match.id === 'omega3_dha_mg' ? 1000 : 1),
      unit: match.unit,
      sourceMeta: data
    });
  }
  const sodium = values.get('sodium_mg')?.amount;
  if (values.get('salt_g')?.amount == null && sodium != null) {
    values.set('salt_g', {
      nutrientId: 'salt_g',
      amount: (sodium * 2.5) / 1000,
      unit: 'g',
      isDerived: true
    });
  }
  return [...values.values()];
}

function componentTree(
  records: ReadonlyMap<number, RawFood>,
  id: number,
  depth = 0,
  ancestors: readonly number[] = [],
  factor = 1
): NonNullable<SourceFood['components']> {
  if (ancestors.includes(id))
    throw new Error(`SLV contains a circular ingredient reference at food ${id}.`);
  return (records.get(id)?.ingredients ?? []).flatMap((child) => {
    const nested = records.get(child.nummer)?.ingredients;
    const nestedWeight = nested?.reduce((sum, row) => sum + (row.viktEfterTillagning ?? 0), 0);
    const amountG =
      child.viktEfterTillagning == null ? undefined : child.viktEfterTillagning * factor;
    return [
      {
        foodId: String(child.nummer),
        name: child.namn,
        depth,
        amountG,
        rawAmountG: child.viktForeTillagning == null ? undefined : child.viktForeTillagning * factor
      },
      ...(amountG != null && nestedWeight
        ? componentTree(
            records,
            child.nummer,
            depth + 1,
            [...ancestors, id],
            amountG / nestedWeight
          )
        : [])
    ];
  });
}

function dietaryClassification(
  records: ReadonlyMap<number, RawFood>,
  item: RawFood,
  components: NonNullable<SourceFood['components']>
): CatalogClassification {
  if (components.length === 0) {
    return {
      dietary: classifySlvLeaf(item.sv.namn, item.classifications, 100, 100)
    };
  }
  const roots = components.filter(({ depth }) => depth === 0);
  const cookedGrams = roots.reduce((sum, row) => sum + (row.amountG ?? 0), 0);
  if (cookedGrams <= 0) return {};

  const useComponentNova =
    roots.every(({ amountG }) => amountG !== undefined) &&
    slvFacet(item.classifications, 'Z').includes('Hemlagat');
  const home = [useComponentNova];
  const leaves = components.flatMap((component, sortOrder) => {
    const record = component.foodId ? records.get(Number(component.foodId)) : undefined;
    if ((components[sortOrder + 1]?.depth ?? 0) > component.depth) {
      home[component.depth + 1] =
        Boolean(home[component.depth]) &&
        Boolean(record && slvFacet(record.classifications, 'Z').includes('Hemlagat'));
      return [];
    }
    const grams = component.amountG ?? 0;
    if (component.amountG === 0 && !component.rawAmountG) return [];
    const dietary =
      record && component.amountG !== undefined
        ? classifySlvLeaf(
            record.sv.namn,
            record.classifications,
            grams,
            component.rawAmountG ?? null
          )
        : unknownDietary(grams);
    return [{ sortOrder, dietary: home[component.depth] ? dietary : withNova(dietary, grams) }];
  });
  const dietary = scaleDietary(sumDietary(leaves.map((row) => row.dietary)), 100 / cookedGrams);
  return {
    dietary: useComponentNova ? dietary : withNova(dietary, 100),
    dietaryComponents: { cookedGrams, useComponentNova, leaves }
  };
}

export async function slvAdapter(dataDir: string): Promise<FoodSourceAdapter> {
  const dir = join(dataDir, 'slv');
  const { version, files } = manifest.parse(await readJson(join(dir, 'manifest.json')));
  return {
    source: slvSource,
    version,
    async *records() {
      const records = new Map<number, RawFood>();
      for (const file of files) {
        const item = rawFood.parse(await readJson(join(dir, file)));
        records.set(item.sv.nummer, item);
      }
      for (const [id, item] of records) {
        const components = componentTree(records, id);
        const dietary = dietaryClassification(records, item, components);
        yield {
          id: String(id),
          revision: hash(['slv-nutrients-v2', item, components, dietary]),
          name: item.sv.namn,
          nameEn: item.en,
          kind: item.sv.livsmedelsTypId === 2 ? 'dish' : 'generic',
          category:
            item.classifications.find(({ fasett }) => fasett?.startsWith('A '))?.namn ?? undefined,
          classification: { codes: item.classifications, ...dietary },
          nutrients: readNutrients(item),
          components
        };
      }
    }
  };
}
