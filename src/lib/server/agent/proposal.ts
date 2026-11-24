import { z } from 'zod';
import { maxMealTitleLength } from '../../meal-title.ts';
import { mealTypes } from '../../meal-types.ts';
import { normalizeUnit } from '../nutrition/amounts.ts';
import { ingredientEvidence } from '../nutrition/ingredient-evidence.ts';
import {
  canonicalNutrients,
  householdPortionUnits,
  standardUnits
} from '../../nutrition-reference.ts';
import { AgentError } from './provider.ts';

const quantity = z.number().positive();
const unit = z.string().trim().min(1).max(80);
const confidence = z.number().min(0).max(1);
const label = z.string().trim().min(1).max(200);
export const mealTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(maxMealTitleLength)
  .regex(/^[^\r\n]+$/u);
const reference = z.uuid();
const assumptions = z.array(label).max(12).default([]);
const productType = z.enum(['food', 'supplement']);

const addedFood = z.object({ foodId: reference, quantity, unit });
const adjustmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), food: addedFood }),
  z.object({ kind: z.literal('remove'), component: label }),
  z.object({ kind: z.literal('substitute'), component: label, food: addedFood })
]);

const foodSelection = z.object({ kind: z.literal('food'), foodId: reference, quantity, unit });
const recipeSelection = z.object({
  kind: z.literal('recipe'),
  recipeId: reference,
  servings: quantity
});
export const catalogSelection = z.discriminatedUnion('kind', [foodSelection, recipeSelection]);
export type CatalogSelection = z.infer<typeof catalogSelection>;

const nutrientIds = canonicalNutrients.map(({ id }) => id);
const estimateNutrients = z.partialRecord(z.enum(nutrientIds), z.number().nonnegative());

const foodItem = addedFood.extend({ kind: z.literal('food'), confidence, assumptions });
const estimateItem = z.object({
  kind: z.literal('estimate'),
  label,
  grams: quantity,
  per100g: estimateNutrients,
  confidence,
  assumptions: z.array(label).min(1).max(12)
});
const productFallback = z.discriminatedUnion('kind', [foodItem, estimateItem]);
const selection = z.discriminatedUnion('kind', [
  foodSelection,
  recipeSelection,
  z.object({
    kind: z.literal('product_variant'),
    query: label,
    quantity,
    unit,
    productType,
    fallback: productFallback.nullish()
  }),
  z.object({ kind: z.literal('grams'), grams: quantity })
]);

export const clarificationOption = z.object({ label, selection });
const otherProposalItems = [
  z.object({
    kind: z.literal('recipe'),
    recipeId: reference,
    servings: quantity,
    confidence,
    assumptions,
    adjustments: z.array(adjustmentSchema).max(12).default([])
  }),
  z.object({
    kind: z.literal('dish_adjustment'),
    foodId: reference,
    grams: quantity,
    confidence,
    assumptions,
    adjustments: z.array(adjustmentSchema).min(1).max(12)
  }),
  estimateItem,
  z.object({
    kind: z.literal('clarify'),
    question: z.string().min(1).max(500),
    options: z.array(clarificationOption).max(8),
    phrase: label.optional()
  })
] as const;

const catalogFoodItem = foodItem.extend({ labelPer100g: estimateNutrients.optional() });
export const maxMealGroups = 8;
export const maxReviewItems = 64;
const itemIndex = z
  .number()
  .int()
  .min(0)
  .max(maxReviewItems - 1);
const mealGroup = z.object({
  title: mealTitleSchema.optional(),
  meal: z.enum(mealTypes).optional(),
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  rawText: z.string().min(1).max(3000),
  itemIndexes: z.array(itemIndex).min(1).max(maxReviewItems)
});
export const proposalSchema = z.object({
  reply: z.string().trim().min(1).max(3000),
  title: mealTitleSchema.optional().catch(undefined),
  meal: z.enum(mealTypes).optional(),
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  needsClarification: z.boolean(),
  meals: z.array(mealGroup).min(1).max(maxMealGroups).optional(),
  items: z
    .array(z.discriminatedUnion('kind', [catalogFoodItem, ...otherProposalItems]))
    .min(1)
    .max(maxReviewItems)
});

const namedProductItem = z.object({
  kind: z.literal('product'),
  query: label,
  quantity,
  unit,
  productType,
  userLabel: estimateItem.optional(),
  userIngredients: ingredientEvidence.optional(),
  fallback: productFallback.nullable()
});

export const agentProposalSchema = proposalSchema
  .omit({ meals: true })
  .extend({
    items: z
      .array(z.discriminatedUnion('kind', [foodItem, ...otherProposalItems, namedProductItem]))
      .max(16),
    review: z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('keep') }),
        z.object({
          action: z.literal('update'),
          itemIndexes: z.array(itemIndex.nullable()).max(16),
          removeIndexes: z.array(itemIndex).max(maxReviewItems).optional(),
          groupIndexes: z
            .array(
              z
                .number()
                .int()
                .min(0)
                .max(maxMealGroups - 1)
                .nullable()
            )
            .max(16)
            .optional()
        }),
        z.object({ action: z.literal('new') })
      ])
      .optional()
  })
  .refine(
    ({ items, review }) =>
      items.length > 0 || review?.action === 'keep' || review?.action === 'update',
    { message: 'A new meal needs at least one item.', path: ['items'] }
  );

export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type NamedProductItem = z.infer<typeof namedProductItem>;
export type Proposal = z.infer<typeof proposalSchema>;
export type ProposedItem = Proposal['items'][number];
export type ClarificationOption = z.infer<typeof clarificationOption>;

// The provider receives a compact numeric-map schema. The server still validates every nutrient ID.
export const agentProposalInputSchema = z.toJSONSchema(agentProposalSchema, {
  io: 'input',
  target: 'draft-7',
  override: ({ zodSchema, jsonSchema }) => {
    if (zodSchema === estimateNutrients) {
      delete jsonSchema.propertyNames;
      delete jsonSchema.properties;
    }
  }
});

export function retainProductLabel<T extends AgentProposal['items'][number]>(
  previous: ProposedItem,
  next: T
): T {
  if (
    previous.kind === 'food' &&
    next.kind === 'food' &&
    previous.foodId === next.foodId &&
    previous.labelPer100g
  ) {
    return { ...next, labelPer100g: previous.labelPer100g, assumptions: [...previous.assumptions] };
  }
  return next;
}

export function selectedCatalogItem(choice: CatalogSelection) {
  return choice.kind === 'food'
    ? { ...choice, confidence: 1, assumptions: [] }
    : { ...choice, confidence: 1, assumptions: [], adjustments: [] };
}

export type ProposalCatalog = {
  foodUnits(foodId: string): Promise<readonly string[] | null>;
  foodComponents(foodId: string): Promise<readonly string[] | null>;
  recipeIngredients(recipeId: string): Promise<readonly string[] | null>;
};

const allowedUnits = new Set<string>([
  ...Object.keys(householdPortionUnits),
  ...standardUnits.map(({ unit: value }) => value)
]);

function invalid(message: string): never {
  throw new AgentError('INVALID_PROPOSAL', message);
}

export async function validateProposal(input: unknown, catalog: ProposalCatalog) {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) invalid('The model proposal did not match the required structure.');
  const proposal = parsed.data;
  if (proposal.needsClarification && !proposal.items.some(({ kind }) => kind === 'clarify')) {
    invalid('The proposed clarification must include a question.');
  }
  if (
    proposal.items.some(
      (item) => item.kind === 'estimate' && Object.keys(item.per100g).length === 0
    )
  ) {
    invalid('Estimates must specify at least one nutrient amount.');
  }

  async function validateFood(foodId: string, unitName?: string) {
    const available = await catalog.foodUnits(foodId);
    if (!available) invalid('The proposal references an unknown food.');
    if (unitName) {
      const normalized = normalizeUnit(unitName);
      if (
        !allowedUnits.has(normalized) &&
        !available.some((item) => normalizeUnit(item) === normalized)
      ) {
        invalid(`The proposal uses an unsupported unit or portion: ${unitName}.`);
      }
    }
  }

  async function validateAdjustments(
    adjustments: z.infer<typeof adjustmentSchema>[],
    components: readonly string[]
  ) {
    const seen = new Set<string>();
    for (const adjustment of adjustments) {
      if (adjustment.kind !== 'add') {
        const { component } = adjustment;
        if ((components.length && !components.includes(component)) || seen.has(component)) {
          invalid('The proposal references an invalid or repeated component.');
        }
        seen.add(component);
      }
      if (adjustment.kind !== 'remove')
        await validateFood(adjustment.food.foodId, adjustment.food.unit);
    }
  }

  for (const item of proposal.items) {
    if (item.kind === 'food') {
      await validateFood(item.foodId, item.unit);
    } else if (item.kind === 'dish_adjustment') {
      const components = await catalog.foodComponents(item.foodId);
      if (!components) invalid('The proposal references an unknown dish.');
      await validateAdjustments(item.adjustments, components);
    } else if (item.kind === 'recipe') {
      const ingredients = await catalog.recipeIngredients(item.recipeId);
      if (!ingredients) invalid('The proposal references an unknown recipe.');
      await validateAdjustments(item.adjustments, ingredients);
    } else if (item.kind === 'clarify') {
      for (const option of item.options) {
        if (option.selection.kind === 'food')
          await validateFood(option.selection.foodId, option.selection.unit);
        if (
          option.selection.kind === 'recipe' &&
          !(await catalog.recipeIngredients(option.selection.recipeId))
        ) {
          invalid('The clarification references an unknown recipe.');
        }
      }
    }
  }
  return proposal;
}
