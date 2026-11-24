import { generatedMealTitle } from '../../meal-title.ts';
import type { MealSection } from '../../meal-sections.ts';
import { reviewedItems, type ClarificationIssue, type TurnResolution } from './clarify.ts';
import { maxReviewItems, type Proposal } from './proposal.ts';
import { AgentError } from './provider.ts';

export function combineMealSections(
  sections: readonly { section: MealSection; resolution: TurnResolution }[]
): TurnResolution {
  const items: TurnResolution['items'] = [];
  const proposed: Proposal['items'] = [];
  const issues: ClarificationIssue[] = [];
  const meals = sections.map(({ section, resolution }) => {
    const offset = proposed.length;
    const { proposal, clarification } = resolution;
    proposed.push(...proposal.items);
    for (const [index, item] of reviewedItems(resolution.items, proposal.items.length)) {
      items.push({ ...item, itemIndex: offset + index });
    }
    if (clarification) {
      const { additional = [], ...primary } = clarification;
      for (const issue of [primary, ...additional]) {
        issues.push({ ...issue, itemIndex: offset + issue.itemIndex });
      }
    }
    return {
      rawText: section.text,
      meal: section.meal ?? proposal.meal,
      title: section.title ?? generatedMealTitle(proposal.title),
      loggedAt: proposal.loggedAt,
      itemIndexes: proposal.items.map((_, index) => offset + index)
    };
  });
  if (proposed.length > maxReviewItems) {
    throw new AgentError(
      'INVALID_PROPOSAL',
      'This message has too many foods. Log fewer meals at a time.'
    );
  }
  const [first, ...additional] = issues;
  return {
    items,
    clarification: first ? { ...first, additional } : null,
    proposal: {
      reply: `I found ${meals.length} meals.`,
      needsClarification: proposed.some(({ kind }) => kind === 'clarify'),
      items: proposed,
      meals
    }
  };
}

export function mealsToCommit(proposal: Proposal, items: TurnResolution['items'], rawText: string) {
  if (!proposal.meals) return [{ ...proposal, items, rawText }];
  const resolved = reviewedItems(items, proposal.items.length);
  const indexes = proposal.meals.flatMap(({ itemIndexes }) => itemIndexes);
  if (new Set(indexes).size !== items.length || indexes.length !== items.length) {
    throw new AgentError('INVALID_PROPOSAL', 'The meal groups did not match the resolved foods.');
  }
  return proposal.meals.map(({ itemIndexes, ...meal }) => ({
    ...meal,
    items: itemIndexes.map((index) => {
      const item = resolved.get(index);
      if (!item) throw new AgentError('INVALID_PROPOSAL', 'A meal is missing a resolved food.');
      return item;
    })
  }));
}
