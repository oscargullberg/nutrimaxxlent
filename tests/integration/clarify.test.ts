import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { runAgent } from '../../src/lib/server/agent/agent';
import {
  applyClarification,
  continueClarification,
  resolveForLogging
} from '../../src/lib/server/agent/clarify';
import { preSearch } from '../../src/lib/server/agent/presearch';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { connectDatabase } from '../../src/lib/server/db/client';
import { foodAliases, foodNutrients, foodSources, foods } from '../../src/lib/server/db/schema';
import { createThread, deleteThread } from '../../src/lib/server/services/threads';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)('a free-text edit changes only the targeted draft item', async () => {
  const { db, close } = connectDatabase(databaseUrl!);
  const thread = await createThread(db);
  const originalItems = [
    {
      kind: 'estimate',
      label: 'Lentils',
      grams: 50,
      confidence: 0.95,
      assumptions: ['Cooked quantity.'],
      per100g: { energy_kcal: 120 }
    },
    {
      kind: 'clarify',
      phrase: 'Coconut milk',
      question: 'Which coconut milk did you have?',
      options: []
    },
    {
      kind: 'estimate',
      label: 'Rice',
      grams: 60,
      confidence: 0.75,
      assumptions: ['Cooked quantity.'],
      per100g: { energy_kcal: 120 }
    }
  ];
  try {
    const draft = await resolveForLogging(
      db,
      {
        reply: 'Review your curry.',
        needsClarification: true,
        meal: 'dinner',
        items: originalItems
      },
      { estimateThreshold: 200, confirmed: [2] }
    );
    const provider = Object.assign(
      new FakeProvider((_text, _step, request) => {
        expect(request.system).toContain('pendingReview');
        expect(request.system).toContain('Which coconut milk did you have?');
        return {
          text: '',
          toolCalls: [
            {
              id: 'edit',
              name: 'submit_proposal',
              input: {
                reply: 'Updated the lentils.',
                needsClarification: false,
                review: { action: 'update', itemIndexes: [0] },
                items: [{ ...originalItems[0], grams: 75 }]
              }
            }
          ]
        };
      }),
      { lookupProduct: async () => ({ product: null, alternatives: [] }) }
    );
    const result = await runAgent(db, {
      threadId: thread.id,
      text: 'I had 75 g of lentils.',
      provider,
      pendingReview: { ...draft, rawText: 'Lentils, coconut milk, and rice' }
    });
    expect(result).toMatchObject({
      reviewAction: 'update',
      proposal: { meal: 'dinner' },
      items: [
        { itemIndex: 0, label: 'Lentils', grams: 75 },
        { itemIndex: 2, label: 'Rice', grams: 60 }
      ],
      clarification: { itemIndex: 1, phrase: 'Coconut milk', additional: [] },
      confirmed: [2]
    });
  } finally {
    await deleteThread(db, thread.id);
    await close();
  }
});

test.skipIf(!databaseUrl)(
  'clarifies ambiguous products and unresolved amounts and confirms large estimates',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const id = `clarify-${randomUUID()}`;
    try {
      await db.insert(foodSources).values({
        id,
        name: 'Fixture',
        license: 'CC0',
        attribution: 'Fixture',
        homepage: 'https://example.test'
      });
      const [chocolate, berry] = await db
        .insert(foods)
        .values(
          ['Chocolate', 'Berry'].map((name) => ({
            sourceId: id,
            sourceFoodId: name,
            sourceVersion: '1',
            kind: 'branded' as const,
            name: name + ' bar',
            searchText: name.toLowerCase() + ' bar',
            brand: 'Barebells'
          }))
        )
        .returning({ id: foods.id });
      const phrase = `barbell fixture ${id}`;
      await db
        .insert(foodAliases)
        .values(
          [chocolate, berry].map((food) => ({ foodId: food!.id, alias: phrase, source: id }))
        );
      await db.insert(foodNutrients).values([
        { foodId: chocolate!.id, amount: 350, nutrientId: 'energy_kcal', unit: 'kcal' },
        { foodId: berry!.id, amount: 420, nutrientId: 'energy_kcal', unit: 'kcal' }
      ]);
      const candidates = await preSearch(db, phrase);
      const meal = { reply: 'Logging your food', needsClarification: false };
      const food = {
        kind: 'food',
        foodId: chocolate!.id,
        quantity: 50,
        unit: 'g',
        confidence: 0.99
      };

      const ambiguous = await resolveForLogging(
        db,
        { ...meal, items: [food] },
        {
          candidates: [{ mention: 'unrelated', query: 'unrelated', foods: [] }, ...candidates],
          estimateThreshold: 200
        }
      );
      expect(ambiguous.clarification).toMatchObject({
        code: 'AMBIGUOUS_MATCH',
        phrase: candidates[0]?.query,
        options: expect.arrayContaining([
          expect.objectContaining({ nutrients: { energy_kcal: 210 } })
        ])
      });
      const broadResults = candidates.map((mention) => ({
        ...mention,
        foods: mention.foods.map((candidate) => ({ ...candidate, match: 'text' as const }))
      }));
      expect(
        (
          await resolveForLogging(
            db,
            { ...meal, items: [food] },
            {
              candidates: broadResults,
              estimateThreshold: 200
            }
          )
        ).clarification
      ).toBeNull();
      const berryOption = ambiguous.clarification!.options.find(
        (option) => option.selection.kind === 'food' && option.selection.foodId === berry!.id
      )!;
      const selected = applyClarification(ambiguous.proposal, ambiguous.clarification!, {
        optionId: berryOption.id
      });
      expect(
        (
          await resolveForLogging(db, selected, {
            candidates,
            estimateThreshold: 200,
            confirmed: [0]
          })
        ).items[0]?.foodId
      ).toBe(berry!.id);

      const continued = await continueClarification(
        db,
        ambiguous.proposal,
        ambiguous.clarification!,
        { optionId: berryOption.id },
        { estimateThreshold: 200 }
      );
      expect(continued.items[0]?.foodId).toBe(berry!.id);
      const repeated = await preSearch(db, phrase);
      expect(repeated[0]?.foods[0]).toMatchObject({ id: berry!.id, match: 'learned_alias' });

      const unresolved = await resolveForLogging(
        db,
        { ...meal, items: [{ ...food, quantity: 1, unit: 'cup' }] },
        { estimateThreshold: 200 }
      );
      expect(unresolved.clarification?.code).toBe('UNIT_UNRESOLVED');
      const grounded = applyClarification(unresolved.proposal, unresolved.clarification!, {
        grams: 55
      });
      expect(
        (await resolveForLogging(db, grounded, { estimateThreshold: 200, confirmed: [0] })).items[0]
          ?.grams
      ).toBe(55);

      const estimate = {
        kind: 'estimate',
        label: 'Mystery meal',
        grams: 300,
        confidence: 0.9,
        assumptions: ['Example'],
        per100g: { energy_kcal: 100 }
      };
      const large = await resolveForLogging(
        db,
        { ...meal, items: [estimate] },
        { estimateThreshold: 200 }
      );
      expect(large.clarification).toMatchObject({
        code: 'ESTIMATE_CONFIRMATION',
        options: [{ id: 'option-1', nutrients: { energy_kcal: 300 } }]
      });
    } finally {
      await db.delete(foods).where(eq(foods.sourceId, id));
      await db.delete(foodSources).where(eq(foodSources.id, id));
      await close();
    }
  }
);
