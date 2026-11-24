import { z } from 'zod';
import { FakeProvider } from './fake.ts';
import type { preSearch } from './presearch.ts';
import type { ProviderStep } from './provider.ts';

const componentResult = z.object({
  components: z.array(
    z.object({ id: z.uuid(), name: z.string(), amountG: z.number().nullable(), depth: z.number() })
  )
});

export function fixtureProvider(candidates: Awaited<ReturnType<typeof preSearch>>) {
  return new FakeProvider((text, step, request) => {
    const reply = 'I found your food.';
    const submit = (items: unknown[], title?: string): ProviderStep => ({
      text: reply,
      toolCalls: [
        {
          id: 'fixture-proposal',
          name: 'submit_proposal',
          input: {
            reply,
            title,
            items,
            needsClarification: items.some(
              (item) =>
                typeof item === 'object' &&
                item !== null &&
                'kind' in item &&
                item.kind === 'clarify'
            )
          }
        }
      ]
    });
    const first = candidates[0]?.foods[0];
    const choice = candidates[0]?.recipes[0];
    if (!first && choice)
      return submit([{ kind: 'recipe', recipeId: choice.id, servings: 1, confidence: 0.98 }]);
    if (!first)
      return submit([{ kind: 'clarify', question: 'Which food did you have?', options: [] }]);

    if (/carbonara/u.test(text) && /(?:no |add |without |utan )/u.test(text)) {
      const dish = candidates[0]?.foods.find((food) => food.kind === 'dish') ?? first;
      if (step === 0)
        return {
          text: 'Checking the ingredients.',
          toolCalls: [{ id: 'fixture-food', name: 'get_food', input: { id: dish.id } }]
        };
      const last = request.messages.at(-1);
      const output = last?.role === 'tool' ? last.content[0] : undefined;
      const result =
        output?.type === 'tool-result' && output.output.type === 'text'
          ? componentResult.safeParse(JSON.parse(output.output.value) as unknown)
          : undefined;
      const components = result?.data?.components ?? [];
      const removed = components.find(({ name }) =>
        /pancetta|bacon|sidflask|sidfläsk/u.test(name.toLowerCase())
      );
      const peas = candidates.find(({ query }) => /peas|artor/u.test(query))?.foods[0];
      const cooked = components
        .filter(({ depth }) => depth === 0)
        .reduce((sum, item) => sum + (item.amountG ?? 0), 0);
      const servings = Number(text.match(/^(\d+(?:\.\d+)?)\s*x/u)?.[1] ?? 1);
      const adjustments = [];
      if (removed) adjustments.push({ kind: 'remove', component: removed.id });
      if (peas)
        adjustments.push({ kind: 'add', food: { foodId: peas.id, quantity: 50, unit: 'g' } });
      if (adjustments.length)
        return submit(
          [
            {
              kind: 'dish_adjustment',
              foodId: dish.id,
              grams: servings * (cooked ? cooked / 4 : 300),
              confidence: 0.98,
              assumptions: peas ? ['One portion of added peas is 50 g.'] : [],
              adjustments
            }
          ],
          peas ? 'Carbonara with peas' : 'Carbonara'
        );
    }

    const items = candidates.flatMap<unknown>(({ foods, recipes, mention }) => {
      const food = foods[0];
      const recipe = recipes[0];
      const amount = mention.match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|dl|tbsp|tsp|x)?(?:\s|$)/u);
      const quantity = amount?.[1] ? Number(amount[1]) : 1;
      const unit = amount?.[2] && amount[2] !== 'x' ? amount[2] : 'portion';
      if (food) return [{ kind: 'food', foodId: food.id, quantity, unit, confidence: 0.98 }];
      if (recipe)
        return [{ kind: 'recipe', recipeId: recipe.id, servings: quantity, confidence: 0.98 }];
      return [];
    });
    return submit(
      items.length
        ? items
        : [{ kind: 'clarify', question: 'Which food did you have?', options: [] }]
    );
  });
}
