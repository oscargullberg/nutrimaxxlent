import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { foodComponents, foods, portions, recipeIngredients, recipes } from '../db/schema.ts';
import {
  portionUnitName,
  productLabelSource,
  standardUnits,
  type NutrientId
} from '../../nutrition-reference.ts';
import { normalizeSearch } from '../importers/source.ts';
import {
  isLearnedPortion,
  lookupPortionUnit,
  normalizeUnit,
  resolveMeasuredAmount,
  scaleNutrients,
  type NutrientAmounts
} from '../nutrition/amounts.ts';
import { adjustDish } from '../nutrition/dishes.ts';
import {
  adjustedCatalogDietary,
  catalogDietary,
  scaleDietary,
  unknownDietary,
  type DietaryAmounts
} from '../nutrition/dietary.ts';
import { rollupRecipe } from '../nutrition/recipes.ts';
import { getFood } from '../services/catalog.ts';
import { productComposition } from '../services/product-composition.ts';
import { getRecipe, getRecipeTree } from '../services/recipes.ts';
import { validateProposal, type ProposalCatalog, type ProposedItem } from './proposal.ts';
import { AgentError } from './provider.ts';
import { swedishDefaults } from './swedish-defaults.ts';

export type ResolvedItem = {
  kind: Exclude<ProposedItem['kind'], 'clarify'>;
  foodId?: string;
  recipeId?: string;
  label: string;
  nameEn?: string | null;
  itemIndex?: number;
  quantity: number;
  unit: string;
  grams: number;
  provenance: 'catalog' | 'recipe' | 'estimate' | 'corrected';
  confidence: number;
  assumptions: string[];
  nutrients: NutrientAmounts;
  estimatedNutrients?: NutrientId[];
  dietary: DietaryAmounts;
  resolution: Exclude<ProposedItem, { kind: 'clarify' }>;
};

export function databaseProposalCatalog(db: Pick<Database, 'select'>): ProposalCatalog {
  return {
    async foodUnits(id) {
      const [food] = await db.select({ id: foods.id }).from(foods).where(eq(foods.id, id));
      if (!food) return null;
      return (
        await db
          .select({ unit: portions.unit, label: portions.label })
          .from(portions)
          .where(eq(portions.foodId, id))
      ).flatMap(({ unit, label }) => [unit, label]);
    },
    async foodComponents(id) {
      const [food] = await db.select({ id: foods.id }).from(foods).where(eq(foods.id, id));
      if (!food) return null;
      return (
        await db
          .select({ id: foodComponents.id })
          .from(foodComponents)
          .where(eq(foodComponents.parentFoodId, id))
      ).map(({ id }) => id);
    },
    async recipeIngredients(id) {
      const [recipe] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id));
      if (!recipe) return null;
      return (
        await db
          .select({ id: recipeIngredients.id })
          .from(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, id))
      ).map(({ id }) => id);
    }
  };
}

type CatalogFood = NonNullable<Awaited<ReturnType<typeof getFood>>>;
type FoodWithAmounts = Pick<
  CatalogFood,
  | 'sourceId'
  | 'sourceFoodId'
  | 'name'
  | 'kind'
  | 'category'
  | 'components'
  | 'densityGPerMl'
  | 'portions'
>;
export type PortionLookup = (food: CatalogFood, unit: string) => Promise<CatalogFood | null>;

function learnedPortionReason({ grams, sourceUrl, unit }: CatalogFood['portions'][number]) {
  const host = sourceUrl && URL.parse(sourceUrl)?.hostname;
  return `Estimated weight: ${grams} g per ${portionUnitName(unit)}${host ? ` (${host})` : ''}.`;
}

function defaultPortion(food: FoodWithAmounts) {
  const user = food.portions.find(({ source, isDefault }) => source === 'user' && isDefault);
  if (user) return { grams: user.grams };

  const sizeRestricted = /\b(?:kids?|children|child|barn|junior|small|large|value|dollar)\b/u;
  const portions = food.portions.filter(
    ({ label, grams, source }) =>
      !isLearnedPortion(source) && grams > 0 && !sizeRestricted.test(normalizeSearch(label))
  );
  const standard = portions.find(({ label }) =>
    /\b(?:adult|medium|regular|standard|normal|mellan|ordinarie)\b/u.test(normalizeSearch(label))
  );
  const catalog = standard ?? portions.find(({ isDefault }) => isDefault);
  if (catalog)
    return {
      grams: catalog.grams,
      reason: `Catalog serving: ${catalog.label} (${catalog.grams} g per serving).`
    };

  const standardSwedish =
    food.sourceId === 'slv'
      ? Object.values(swedishDefaults).find(({ id }) => id === food.sourceFoodId)
      : undefined;
  if (standardSwedish) {
    const { grams, serving } = standardSwedish;
    return { grams, reason: `Antaget per portion: ${serving} (${grams} g).` };
  }

  const learned = food.portions.filter(
    ({ source, isDefault }) => isLearnedPortion(source) && isDefault
  );
  const serving = learned.find(({ unit }) => unit === 'portion') ?? learned[0];
  if (serving) return { grams: serving.grams, reason: learnedPortionReason(serving) };
  return null;
}

function estimateDishPortion(food: FoodWithAmounts) {
  const weight = food.components
    .filter(({ depth }) => depth === 0)
    .reduce((sum, item) => sum + (item.amountG ?? 0), 0);
  const category = normalizeSearch(food.category ?? '');
  const name = normalizeSearch(food.name);
  if (food.kind === 'dish' && weight > 0)
    return {
      grams: weight / 4,
      reason: 'One portion assumes a quarter of the published cooked dish weight.'
    };
  if (/\b(?:french fries|fries|pommes frites)\b/u.test(name))
    return { grams: 140, reason: 'Assumed a 140 g side of fries.' };
  if (food.kind === 'dish' || /(?:main dish|pastaratter|huvudratt)/u.test(category))
    return { grams: 300, reason: 'One main dish portion is estimated at 300 g.' };
  if (/side dish|tillbehor/u.test(category))
    return { grams: 150, reason: 'One side portion is estimated at 150 g.' };
  if (/snack|mellanmal/u.test(category))
    return { grams: 50, reason: 'One snack portion is estimated at 50 g.' };
  return null;
}

export function resolveFoodAmount(
  food: FoodWithAmounts,
  quantity: number,
  unit: string,
  allowDishEstimate = true
) {
  if (!Number.isFinite(quantity) || quantity <= 0) return { grams: null };
  const normalized = normalizeUnit(unit);
  if (normalized !== 'portion') {
    const { grams, portion } = resolveMeasuredAmount(quantity, unit, food);
    if (grams) {
      const labelHost =
        portion?.source === productLabelSource && portion.sourceUrl
          ? URL.parse(portion.sourceUrl)?.hostname
          : undefined;
      return {
        grams,
        reason: labelHost
          ? `Product label: ${portion!.label} (${labelHost}).`
          : portion && isLearnedPortion(portion.source)
            ? learnedPortionReason(portion)
            : undefined
      };
    }
    if (food.sourceId !== 'slv') return { grams };
    if (food.sourceFoodId === swedishDefaults.kaffe.id && normalized === 'cup') {
      return {
        grams: quantity * swedishDefaults.kaffe.grams,
        reason: 'Antaget 150 g per kopp bryggkaffe.'
      };
    }
    if (!['st', 'slice'].includes(normalized)) return { grams };
    if (!Object.values(swedishDefaults).some(({ id }) => id === food.sourceFoodId))
      return { grams };
  }
  const serving = defaultPortion(food) ?? (allowDishEstimate ? estimateDishPortion(food) : null);
  return { grams: serving ? quantity * serving.grams : null, reason: serving?.reason };
}

async function resolveWithPortionLookup(
  food: CatalogFood,
  quantity: number,
  unit: string,
  lookupPortion?: PortionLookup
) {
  const lookupUnit = lookupPortion && lookupPortionUnit(unit);
  const amount = resolveFoodAmount(food, quantity, unit, !lookupUnit);
  if (amount.grams || !lookupPortion || !lookupUnit) return { food, ...amount };
  const refreshed = (await lookupPortion(food, lookupUnit)) ?? food;
  return { food: refreshed, ...resolveFoodAmount(refreshed, quantity, unit) };
}

async function requireFood(db: Pick<Database, 'select'>, id: string) {
  const food = await getFood(db, id);
  if (!food) throw new AgentError('INVALID_PROPOSAL', 'The catalog food no longer exists.');
  return food;
}

async function resolveAddition(
  db: Pick<Database, 'select'>,
  item: { foodId: string; quantity: number; unit: string },
  lookupPortion?: PortionLookup
) {
  const { food, grams, reason } = await resolveWithPortionLookup(
    await requireFood(db, item.foodId),
    item.quantity,
    item.unit,
    lookupPortion
  );
  if (!grams)
    throw new AgentError('UNIT_UNRESOLVED', `How many grams of ${food.name} should be added?`);
  return {
    grams,
    reason,
    per100g: food.nutrients,
    dietary: catalogDietary(food.classification, 100)
  };
}

export async function resolveItem(
  db: Pick<Database, 'select' | 'execute'>,
  item: ResolvedItem['resolution'],
  lookupPortion?: PortionLookup
): Promise<ResolvedItem> {
  const base = {
    confidence: item.confidence,
    assumptions: [...item.assumptions],
    resolution: item
  };
  if (item.kind === 'estimate') {
    return {
      ...base,
      kind: item.kind,
      provenance: 'estimate',
      label: item.label,
      quantity: item.grams,
      unit: 'g',
      grams: item.grams,
      nutrients: scaleNutrients(item.per100g, item.grams),
      dietary: unknownDietary(item.grams)
    };
  }

  if (item.kind === 'recipe') {
    const [recipe, tree] = await Promise.all([
      getRecipe(db, item.recipeId),
      getRecipeTree(db, item.recipeId)
    ]);
    if (!recipe || !tree) throw new AgentError('INVALID_PROPOSAL', 'The recipe no longer exists.');
    const factor = item.servings / tree.servings;
    let nutrition = {
      grams: recipe.nutrition.gramsPerServing * item.servings,
      nutrients: scaleNutrients(recipe.nutrition.perServing, 100 * item.servings),
      dietary: scaleDietary(recipe.nutrition.dietary, factor)
    };
    if (item.adjustments.length) {
      const removed = new Set(
        item.adjustments.flatMap((adjustment) =>
          adjustment.kind === 'add' ? [] : [adjustment.component]
        )
      );
      const retained = tree.ingredients.flatMap((ingredient, index) =>
        removed.has(recipe.ingredients[index]?.id ?? '')
          ? []
          : [{ ...ingredient, grams: ingredient.grams * factor }]
      );
      const additions = await Promise.all(
        item.adjustments.flatMap((adjustment) =>
          adjustment.kind === 'remove'
            ? []
            : [
                resolveAddition(db, adjustment.food, lookupPortion).then((food) => ({
                  food: food.per100g,
                  dietary: food.dietary,
                  grams: food.grams,
                  reason: food.reason,
                  optional: false
                }))
              ]
        )
      );
      for (const { reason } of additions) if (reason) base.assumptions.push(reason);
      const originalWeight = tree.ingredients.reduce(
        (sum, ingredient) => sum + (ingredient.optional ? 0 : ingredient.grams),
        0
      );
      const retainedWeight = retained.reduce(
        (sum, ingredient) => sum + (ingredient.optional ? 0 : ingredient.grams),
        0
      );
      const addedWeight = additions.reduce((sum, ingredient) => sum + ingredient.grams, 0);
      const retainedCooked =
        originalWeight > 0 ? (recipe.nutrition.grams * retainedWeight) / originalWeight : 0;
      nutrition = rollupRecipe({
        id: tree.id,
        servings: 1,
        totalWeightG: retainedCooked + addedWeight,
        ingredients: [...retained, ...additions]
      });
    }
    if (nutrition.grams <= 0)
      throw new AgentError('UNIT_UNRESOLVED', 'The recipe has no resolved weight.');
    return {
      ...base,
      kind: item.kind,
      provenance: 'recipe',
      recipeId: recipe.id,
      label: recipe.name,
      quantity: item.servings,
      unit: 'serving',
      ...nutrition
    };
  }

  const catalogFood = await requireFood(db, item.foodId);
  if (item.kind === 'food') {
    const { food, grams, reason } = await resolveWithPortionLookup(
      catalogFood,
      item.quantity,
      item.unit,
      lookupPortion
    );
    if (reason) base.assumptions.push(reason);
    if (!grams)
      throw new AgentError('UNIT_UNRESOLVED', `How many grams of ${food.name} did you have?`);
    const { documented, estimates } =
      food.kind === 'branded'
        ? await productComposition(db, food, item.labelPer100g)
        : { documented: food.nutrients, estimates: {} };
    const volumeLabel = food.nutrientRows.find(
      ({ sourceMeta }) => typeof sourceMeta?.referenceMl === 'number'
    );
    const volume = standardUnits.find(
      ({ unit, dimension }) => unit === normalizeUnit(item.unit) && dimension === 'volume'
    );
    const labelGrams =
      volume && food.densityGPerMl && volumeLabel
        ? item.quantity * volume.factorToBase * food.densityGPerMl
        : grams;
    const estimatedNutrients = new Set(Object.keys(estimates) as NutrientId[]);
    if (estimatedNutrients.size) {
      base.assumptions.push('Some nutrients are estimated from the product ingredients.');
    }
    if (volumeLabel?.sourceMeta?.weightEstimated === true) {
      base.assumptions.push(
        volume
          ? 'The label is measured by volume. The equivalent weight is estimated.'
          : 'The label is measured by volume. Nutrients for this weight use an estimated density.'
      );
      if (!volume) {
        for (const { nutrientId, sourceMeta } of food.nutrientRows) {
          if (
            sourceMeta?.weightEstimated === true &&
            !Object.hasOwn(item.labelPer100g ?? {}, nutrientId)
          )
            estimatedNutrients.add(nutrientId as NutrientId);
        }
      }
    }
    return {
      ...base,
      kind: item.kind,
      foodId: food.id,
      label: food.name,
      nameEn: food.nameEn,
      quantity: item.quantity,
      unit: item.unit,
      grams,
      provenance: 'catalog',
      nutrients: {
        ...scaleNutrients(documented, labelGrams),
        ...scaleNutrients(estimates, grams),
        ...scaleNutrients(item.labelPer100g ?? {}, grams)
      },
      ...(estimatedNutrients.size ? { estimatedNutrients: [...estimatedNutrients] } : {}),
      dietary: catalogDietary(food.classification, grams)
    };
  }

  const food = catalogFood;
  const referencedIds = new Set(
    item.adjustments.flatMap((adjustment) =>
      adjustment.kind === 'add' ? [] : [adjustment.component]
    )
  );
  const components = await Promise.all(
    food.components.map(async (component) => {
      if (referencedIds.has(component.id) && component.amountG === null) {
        throw new AgentError(
          'UNIT_UNRESOLVED',
          `The source does not give a cooked weight for ${component.name}.`
        );
      }
      if (referencedIds.has(component.id) && !component.childFoodId) {
        throw new AgentError(
          'UNIT_UNRESOLVED',
          `The source does not provide nutrition for ${component.name}.`
        );
      }
      const child =
        component.childFoodId && referencedIds.has(component.id)
          ? await getFood(db, component.childFoodId)
          : null;
      return {
        id: component.id,
        cookedGrams: component.amountG ?? 0,
        per100g: child?.nutrients ?? {}
      };
    })
  );
  const cookedGrams = food.components
    .filter(({ depth }) => depth === 0)
    .reduce((total, component) => total + (component.amountG ?? 0), 0);
  const adjustments = food.components.length
    ? await Promise.all(
        item.adjustments.map(async (adjustment) => {
          if (adjustment.kind === 'remove')
            return { kind: 'remove' as const, componentId: adjustment.component };
          const addition = await resolveAddition(db, adjustment.food, lookupPortion);
          return adjustment.kind === 'add'
            ? { kind: 'add' as const, food: addition }
            : { kind: 'substitute' as const, componentId: adjustment.component, food: addition };
        })
      )
    : [];
  const result = food.components.length
    ? adjustDish({ per100g: food.nutrients, cookedGrams, components }, item.grams, adjustments)
    : {
        grams: item.grams,
        nutrients: scaleNutrients(food.nutrients, item.grams),
        notes: [
          'The dish has no component tree. Requested adjustments are recorded with the entry.'
        ]
      };
  for (const adjustment of adjustments)
    if (adjustment.kind !== 'remove' && adjustment.food.reason)
      base.assumptions.push(adjustment.food.reason);
  return {
    ...base,
    kind: item.kind,
    foodId: food.id,
    label: food.name,
    nameEn: food.nameEn,
    quantity: item.grams,
    unit: 'g',
    grams: result.grams,
    provenance: 'catalog',
    nutrients: result.nutrients,
    dietary: adjustedCatalogDietary(
      food.classification,
      item.grams,
      food.components,
      food.components.length ? referencedIds : new Set(),
      adjustments.flatMap((adjustment) => (adjustment.kind === 'remove' ? [] : [adjustment.food])),
      result.grams
    ),
    assumptions: [...base.assumptions, ...result.notes]
  };
}

export async function resolveProposal(db: Pick<Database, 'select' | 'execute'>, input: unknown) {
  const proposal = await validateProposal(input, databaseProposalCatalog(db));
  const items = await Promise.all(
    proposal.items.flatMap((item) => (item.kind === 'clarify' ? [] : [resolveItem(db, item)]))
  );
  return { proposal, items };
}
