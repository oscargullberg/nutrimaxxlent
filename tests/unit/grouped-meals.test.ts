import { expect, test } from 'vitest';
import { combineMealSections, mealsToCommit } from '../../src/lib/server/agent/grouped-meals.ts';
import { validateProposal } from '../../src/lib/server/agent/proposal.ts';
import type { TurnResolution } from '../../src/lib/server/agent/clarify.ts';
import { unknownDietary } from '../../src/lib/server/nutrition/dietary.ts';

function resolvedMeal(label: string, needsReview = false): TurnResolution {
  const per100g = { energy_kcal: 130 };
  const assumptions = ['Standard serving'];
  const resolution = {
    kind: 'estimate' as const,
    label,
    grams: 100,
    confidence: 0.75,
    assumptions,
    per100g
  };
  return {
    proposal: { items: [resolution], needsClarification: false, reply: 'I found the food.' },
    items: [
      {
        kind: 'estimate',
        itemIndex: 0,
        label,
        quantity: 100,
        grams: 100,
        unit: 'g',
        confidence: 0.75,
        provenance: 'estimate',
        assumptions,
        resolution,
        nutrients: per100g,
        dietary: unknownDietary(100)
      }
    ],
    clarification: needsReview
      ? {
          code: 'ESTIMATE_CONFIRMATION',
          question: 'Confirm this amount?',
          itemIndex: 0,
          options: []
        }
      : null
  };
}

test('keeps meal attribution through grouped review and saving', async () => {
  const grouped = combineMealSections([
    {
      section: { meal: 'dinner', title: 'Rice bowl', text: 'rice bowl' },
      resolution: resolvedMeal('Rice bowl')
    },
    {
      section: { meal: 'breakfast', text: 'oats' },
      resolution: resolvedMeal('Oats', true)
    }
  ]);
  expect(grouped.clarification).toMatchObject({ itemIndex: 1, code: 'ESTIMATE_CONFIRMATION' });
  const proposal = await validateProposal(grouped.proposal, {
    foodUnits: async () => null,
    foodComponents: async () => null,
    recipeIngredients: async () => null
  });
  expect(mealsToCommit(proposal, grouped.items, 'Original message')).toMatchObject([
    {
      meal: 'dinner',
      title: 'Rice bowl',
      rawText: 'rice bowl',
      items: [{ label: 'Rice bowl', itemIndex: 0 }]
    },
    { meal: 'breakfast', rawText: 'oats', items: [{ label: 'Oats', itemIndex: 1 }] }
  ]);
});
