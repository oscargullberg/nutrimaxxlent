import { learnFoodAlias } from '../services/aliases.ts';
import type { Database } from '../db/client.ts';
import { getFood, type FoodSearchResult } from '../services/catalog.ts';
import { getRecipe } from '../services/recipes.ts';
import { normalizeSearch } from '../importers/source.ts';
import { sameMealItem } from '../../meal-title.ts';
import {
  databaseProposalCatalog,
  resolveFoodAmount,
  resolveItem,
  type PortionLookup,
  type ResolvedItem
} from './resolve.ts';
import { scaleNutrients, type NutrientAmounts } from '../nutrition/amounts.ts';
import {
  retainProductLabel,
  selectedCatalogItem,
  validateProposal,
  type CatalogSelection,
  type ClarificationOption,
  type Proposal
} from './proposal.ts';
import { AgentError } from './provider.ts';
import { resolveNamedProduct } from './resolve-products.ts';
import type { createProductLookup } from './product-lookup.ts';

type Selection = ClarificationOption['selection'] | { kind: 'accept' };
type Option = { id: string; label: string; selection: Selection; nutrients?: NutrientAmounts };
type Mention = { mention: string; query: string; foods: FoodSearchResult[] };
export type ClarificationIssue = {
  code: 'AMBIGUOUS_MATCH' | 'UNIT_UNRESOLVED' | 'ESTIMATE_CONFIRMATION' | 'LOW_CONFIDENCE';
  question: string;
  options: Option[];
  itemIndex: number;
  phrase?: string;
  canEditGrams?: boolean;
};

export type PendingClarification = ClarificationIssue & { additional?: ClarificationIssue[] };
export type ClarificationSelection = { optionId: string } | { grams: number };
export type ClarificationAnswer = ClarificationSelection & { itemIndex: number };
export type ReviewReplacement = { itemIndex: number; replacement: CatalogSelection };

export type TurnResolution = {
  proposal: Proposal;
  items: ResolvedItem[];
  clarification: PendingClarification | null;
};

export function reviewedItems(items: readonly ResolvedItem[] | undefined, count: number) {
  const reviewed = new Map<number, ResolvedItem>();
  for (const [position, item] of (items ?? []).entries()) {
    const index = item.itemIndex ?? (items?.length === count ? position : undefined);
    if (index !== undefined) reviewed.set(index, item);
  }
  return reviewed;
}

function materiallyDifferent(a: FoodSearchResult, b: FoodSearchResult) {
  if (a.brand && b.brand && a.id !== b.id && a.name !== b.name) return true;
  return (
    (a.energyKcal !== null &&
      b.energyKcal !== null &&
      Math.abs(a.energyKcal - b.energyKcal) >= Math.max(30, a.energyKcal * 0.2)) ||
    (a.proteinG !== null && b.proteinG !== null && Math.abs(a.proteinG - b.proteinG) >= 5)
  );
}

async function makeOptions(
  db: Database,
  options: readonly { label: string; selection: Selection }[]
) {
  return Promise.all(
    options.map(async ({ label, selection }, index): Promise<Option> => {
      let nutrients: NutrientAmounts | undefined;
      if (selection.kind === 'food') {
        const food = await getFood(db, selection.foodId);
        if (food) {
          const { grams } = resolveFoodAmount(food, selection.quantity, selection.unit);
          nutrients = scaleNutrients(food.nutrients, grams ?? 100);
          if (!grams) label += ' (nutrients per 100 g)';
        }
      } else if (selection.kind === 'recipe') {
        const recipe = await getRecipe(db, selection.recipeId);
        if (recipe)
          nutrients = scaleNutrients(recipe.nutrition.perServing, selection.servings * 100);
      }
      return { id: `option-${index + 1}`, label, selection, nutrients };
    })
  );
}

export async function resolveForLogging(
  db: Database,
  input: unknown,
  {
    candidates = [],
    estimateThreshold,
    confirmed = [],
    retainedIssues = [],
    reuseItems,
    lookupPortion
  }: {
    candidates?: readonly Mention[];
    estimateThreshold: number;
    confirmed?: readonly number[];
    retainedIssues?: readonly ClarificationIssue[];
    reuseItems?: ReadonlyMap<number, ResolvedItem>;
    lookupPortion?: PortionLookup;
  }
): Promise<TurnResolution> {
  const proposal = await validateProposal(input, databaseProposalCatalog(db));
  const items: ResolvedItem[] = [];
  const issues: ClarificationIssue[] = [...retainedIssues];
  for (const [itemIndex, item] of proposal.items.entries()) {
    const reviewed = reuseItems?.get(itemIndex);
    if (reviewed) {
      items.push({ ...reviewed, itemIndex });
      continue;
    }
    // Pre-search chunks and proposal items can differ in both count and order.
    const foodIds =
      item.kind === 'food' || item.kind === 'dish_adjustment'
        ? [item.foodId]
        : item.kind === 'clarify'
          ? item.options.flatMap(({ selection }) =>
              selection.kind === 'food' ? [selection.foodId] : []
            )
          : [];
    const matchedMentions = candidates.filter(({ query, foods }) =>
      item.kind === 'estimate'
        ? query === normalizeSearch(item.label)
        : foodIds.length > 0 && foodIds.every((id) => foods.some((food) => food.id === id))
    );
    const mention = matchedMentions.length === 1 ? matchedMentions[0] : undefined;
    const phrase = (item.kind === 'clarify' ? item.phrase : undefined) ?? mention?.query;
    if (item.kind === 'clarify') {
      if (!issues.some((issue) => issue.itemIndex === itemIndex)) {
        issues.push({
          code: 'AMBIGUOUS_MATCH',
          question: item.question,
          options: await makeOptions(db, item.options),
          itemIndex,
          phrase
        });
      }
      continue;
    }

    if (
      !confirmed.includes(itemIndex) &&
      (item.kind === 'food' || item.kind === 'estimate') &&
      mention?.foods.length &&
      !issues.some((issue) => issue.itemIndex === itemIndex)
    ) {
      const [first, ...rest] = mention.foods;
      const plausible = rest.filter(
        (food) =>
          (first?.match === 'alias' || first?.match === 'name') &&
          food.match === first.match &&
          materiallyDifferent(first, food)
      );
      const catalogEstimate =
        item.kind === 'estimate' &&
        ['barcode', 'learned_alias', 'default', 'alias', 'name'].includes(first!.match);
      if (first && (plausible.length || catalogEstimate)) {
        const quantity = item.kind === 'food' ? item.quantity : item.grams;
        const unit = item.kind === 'food' ? item.unit : 'g';
        const choices = [first, ...plausible].slice(0, 5).map((food): ClarificationOption => ({
          label: `${food.name} · ${food.sourceName}`,
          selection: { kind: 'food', foodId: food.id, quantity, unit }
        }));
        issues.push({
          code: 'AMBIGUOUS_MATCH',
          question: `Which food did you mean by “${phrase}”?`,
          options: await makeOptions(db, choices),
          itemIndex,
          phrase
        });
      }
    }

    let itemResult: ResolvedItem;
    try {
      itemResult = await resolveItem(
        db,
        item,
        issues.some((issue) => issue.itemIndex === itemIndex) ? undefined : lookupPortion
      );
    } catch (error) {
      if (!(error instanceof AgentError) || error.code !== 'UNIT_UNRESOLVED') throw error;
      if (issues.some((issue) => issue.itemIndex === itemIndex)) continue;
      issues.push({
        code: 'UNIT_UNRESOLVED',
        canEditGrams: item.kind === 'food',
        question: error.message,
        options: [],
        itemIndex,
        phrase
      });
      continue;
    }

    items.push({ ...itemResult, itemIndex });
    if (!confirmed.includes(itemIndex) && !issues.some((issue) => issue.itemIndex === itemIndex)) {
      const kcal = itemResult.nutrients.energy_kcal;
      const largeEstimate = item.kind === 'estimate' && (kcal == null || kcal > estimateThreshold);
      if (largeEstimate || itemResult.confidence < 0.8) {
        issues.push({
          code: largeEstimate ? 'ESTIMATE_CONFIRMATION' : 'LOW_CONFIDENCE',
          canEditGrams: item.kind === 'food' || item.kind === 'estimate',
          question: `Log ${itemResult.label} at ${Number(itemResult.grams.toPrecision(3))} g${largeEstimate ? ' as an estimate' : ''}?`,
          options: [
            {
              id: 'option-1',
              label: 'Confirm this amount',
              selection: { kind: 'accept' },
              nutrients: itemResult.nutrients
            }
          ],
          itemIndex,
          phrase
        });
      }
    }
  }
  const [first, ...additional] = issues.toSorted((a, b) => a.itemIndex - b.itemIndex);
  return { proposal, items, clarification: first ? { ...first, additional } : null };
}

export function applyClarification(
  proposal: Proposal,
  clarification: ClarificationIssue,
  input: ClarificationSelection
) {
  const prior = proposal.items[clarification.itemIndex];
  if (!prior) throw new AgentError('INVALID_PROPOSAL', 'The clarification has expired.');
  const option =
    'optionId' in input ? clarification.options.find(({ id }) => id === input.optionId) : undefined;
  const selection: Selection | undefined =
    'grams' in input ? { kind: 'grams', grams: input.grams } : option?.selection;
  if (!selection) throw new AgentError('INVALID_PROPOSAL', 'Choose one of the available options.');
  if (selection.kind === 'product_variant')
    throw new AgentError('INVALID_PROPOSAL', 'Resolve the product variant before applying it.');
  const items = [...proposal.items];
  if (selection.kind === 'food' || selection.kind === 'recipe') {
    items[clarification.itemIndex] = selectedCatalogItem(selection);
  } else if (selection.kind === 'grams') {
    if (prior.kind === 'food')
      items[clarification.itemIndex] = { ...prior, quantity: selection.grams, unit: 'g' };
    else if (prior.kind === 'dish_adjustment' || prior.kind === 'estimate') {
      items[clarification.itemIndex] = { ...prior, grams: selection.grams };
    } else throw new AgentError('INVALID_PROPOSAL', 'Choose a food or recipe first.');
  }
  const needsClarification = items.some(({ kind }) => kind === 'clarify');
  return { ...proposal, items, needsClarification };
}

export function replaceReviewItems(proposal: Proposal, replacements: readonly ReviewReplacement[]) {
  if (!replacements.length) return proposal;
  const items = [...proposal.items];
  const seen = new Set<number>();
  let changedName = false;
  for (const { itemIndex, replacement } of replacements) {
    const previous = items[itemIndex];
    if (!previous || seen.has(itemIndex)) {
      throw new AgentError('INVALID_PROPOSAL', 'The meal review has changed. Reload the thread.');
    }
    const chosen = selectedCatalogItem(replacement);
    changedName ||= !sameMealItem(previous, chosen);
    items[itemIndex] = retainProductLabel(previous, chosen);
    seen.add(itemIndex);
  }
  return {
    ...proposal,
    title: changedName ? undefined : proposal.title,
    items,
    needsClarification: items.some(({ kind }) => kind === 'clarify')
  };
}

export async function continueClarification(
  db: Database,
  proposal: Proposal,
  clarification: PendingClarification,
  selection: ClarificationSelection | { answers: ClarificationAnswer[] },
  {
    estimateThreshold,
    confirmed = [],
    lookupPortion,
    lookupProduct,
    signal,
    replacements = [],
    previewItems
  }: {
    estimateThreshold: number;
    confirmed?: readonly number[];
    lookupPortion?: PortionLookup;
    lookupProduct?: ReturnType<typeof createProductLookup>;
    signal?: AbortSignal;
    replacements?: readonly ReviewReplacement[];
    previewItems?: readonly ResolvedItem[];
  }
) {
  const issues = [clarification, ...(clarification.additional ?? [])].filter(
    (issue) => !replacements.some(({ itemIndex }) => itemIndex === issue.itemIndex)
  );
  const answers =
    'answers' in selection
      ? selection.answers
      : [{ ...selection, itemIndex: clarification.itemIndex }];
  if (
    issues.length !== answers.length ||
    new Set(answers.map(({ itemIndex }) => itemIndex)).size !== issues.length
  ) {
    throw new AgentError('INVALID_PROPOSAL', 'Review every item that needs confirmation.');
  }

  const updated = replaceReviewItems(proposal, replacements);
  const selections = issues.map((issue) => {
    const answer = answers.find(({ itemIndex }) => itemIndex === issue.itemIndex);
    if (!answer)
      throw new AgentError('INVALID_PROPOSAL', 'The meal review has changed. Reload the thread.');
    const editable =
      issue.canEditGrams ??
      (issue.code === 'UNIT_UNRESOLVED' && proposal.items[issue.itemIndex]?.kind === 'food');
    if ('grams' in answer && !editable) {
      throw new AgentError('INVALID_PROPOSAL', 'This item needs a different clarification.');
    }
    const option =
      'optionId' in answer
        ? issue.options.find(({ id }) => id === answer.optionId)?.selection
        : undefined;
    if (option?.kind === 'product_variant') return { issue, variant: option };
    const item = applyClarification(updated, issue, answer).items[issue.itemIndex]!;
    return { issue, item };
  });

  const resolvedSelections = await Promise.all(
    selections.map(async ({ issue, item, variant }) => {
      if (!variant) return { issue, item, usedFallback: false };
      if (!lookupProduct)
        throw new AgentError('PROVIDER_UNAVAILABLE', 'Product lookup is unavailable.');
      const product = await resolveNamedProduct(
        { ...variant, kind: 'product', fallback: variant.fallback ?? null },
        lookupProduct,
        signal ?? new AbortController().signal,
        { selectedVariant: true }
      );
      return {
        issue,
        item: product,
        usedFallback: product.kind !== 'clarify' && product.confidence < 0.8
      };
    })
  );
  const items = [...updated.items];
  const reuseItems = reviewedItems(previewItems, items.length);
  for (const { itemIndex } of replacements) reuseItems.delete(itemIndex);
  const learned: { phrase: string; foodId: string }[] = [];
  const accepted = new Set(confirmed);
  for (const { issue, item, usedFallback } of resolvedSelections) {
    if (items[issue.itemIndex] !== item) reuseItems.delete(issue.itemIndex);
    items[issue.itemIndex] = item;
    if (item.kind === 'clarify' || usedFallback) {
      accepted.delete(issue.itemIndex);
      continue;
    }
    accepted.add(issue.itemIndex);
    if (issue.code === 'AMBIGUOUS_MATCH' && issue.phrase && item.kind === 'food') {
      learned.push({ phrase: issue.phrase, foodId: item.foodId });
    }
  }
  const resolved = await resolveForLogging(
    db,
    { ...updated, items, needsClarification: items.some(({ kind }) => kind === 'clarify') },
    { estimateThreshold, confirmed: [...accepted], lookupPortion, reuseItems }
  );
  for (const { phrase, foodId } of learned) await learnFoodAlias(db, phrase, foodId);
  return { ...resolved, confirmed: [...accepted] };
}
