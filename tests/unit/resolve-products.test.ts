import { expect, test, vi } from 'vitest';
import type { createProductLookup } from '../../src/lib/server/agent/product-lookup';
import {
  agentProposalSchema,
  proposalSchema,
  type NamedProductItem
} from '../../src/lib/server/agent/proposal';
import {
  resolveNamedProduct,
  resolveNamedProducts
} from '../../src/lib/server/agent/resolve-products';

type Lookup = ReturnType<typeof createProductLookup>;
const product: NamedProductItem = {
  kind: 'product',
  query: 'Example Labs fish oil',
  quantity: 3,
  unit: 'capsules',
  productType: 'supplement',
  fallback: null
};
const generic = {
  kind: 'food',
  foodId: 'f7594e40-5df5-4705-b918-5bcac4105ad4',
  quantity: 2,
  unit: 'portion',
  confidence: 0.98,
  assumptions: []
} as const;
const base = { reply: 'Checking your items.', needsClarification: false };

test('the server resolves named products and keeps generic foods on the catalog path', async () => {
  const namedId = 'f9dc4c1a-11de-428b-a0fb-c164605f1fa6';
  const lookup = vi.fn<Lookup>().mockResolvedValue({ status: 'found', food: { id: namedId } });
  const signal = new AbortController().signal;
  const agentProposal = agentProposalSchema.parse({ ...base, items: [generic, product] });
  expect(proposalSchema.safeParse(agentProposal).success).toBe(false);
  const resolved = await resolveNamedProducts(agentProposal, lookup, signal);

  expect(lookup).toHaveBeenCalledExactlyOnceWith(product.query, signal);
  expect(proposalSchema.parse(resolved).items).toEqual([
    generic,
    { kind: 'food', foodId: namedId, quantity: 3, unit: 'capsules', confidence: 1, assumptions: [] }
  ]);
});

test('a failed lookup permits a food fallback and requires label details for supplements', async () => {
  const lookup = vi.fn<Lookup>().mockResolvedValue({ status: 'not_found', reason: 'no_label' });
  const proposal = agentProposalSchema.parse({
    ...base,
    items: [
      { ...product, query: 'Example yogurt', productType: 'food', fallback: generic },
      { ...product, fallback: generic }
    ]
  });
  const result = await resolveNamedProducts(proposal, lookup, new AbortController().signal);
  expect(lookup.mock.calls.map(([query]) => query)).toEqual(['Example yogurt', product.query]);
  expect(result).toMatchObject({
    needsClarification: true,
    items: [
      {
        ...generic,
        confidence: 0.75,
        assumptions: [expect.stringContaining('generic substitute')]
      },
      { kind: 'clarify', question: expect.stringContaining('product label online'), options: [] }
    ]
  });
});

test('variant choices retain the original count and use lookup again when selected', async () => {
  const lookup = vi
    .fn<Lookup>()
    .mockResolvedValueOnce({
      status: 'ambiguous',
      alternatives: ['Example Labs Fish Oil Forte', 'Example Labs Vegan Omega']
    })
    .mockResolvedValueOnce({ status: 'found', food: { id: generic.foodId } });
  const signal = new AbortController().signal;
  const review = await resolveNamedProduct(product, lookup, signal);
  expect(review.kind).toBe('clarify');
  if (review.kind !== 'clarify') throw new Error('Expected a variant choice.');
  expect(review.options.map(({ label }) => label)).toEqual([
    'Example Labs Fish Oil Forte',
    'Example Labs Vegan Omega'
  ]);
  const selected = review.options[0]?.selection;
  if (selected?.kind !== 'product_variant') throw new Error('Expected a selectable variant.');
  expect(
    await resolveNamedProduct({ ...selected, kind: 'product', fallback: null }, lookup, signal)
  ).toMatchObject({ kind: 'food', foodId: generic.foodId, quantity: 3, unit: 'capsules' });
  expect(lookup).toHaveBeenLastCalledWith('Example Labs Fish Oil Forte', signal);
});

test('label values supplied by the user are offered for review after an unsuccessful lookup', async () => {
  const lookup = vi.fn<Lookup>().mockResolvedValue({ status: 'not_found', reason: 'no_label' });
  const label = {
    kind: 'estimate' as const,
    label: product.query,
    grams: 3,
    per100g: { omega3_epa_mg: 30000 },
    confidence: 1,
    assumptions: ['The label states 300 mg EPA per 1 g capsule.']
  };
  const result = await resolveNamedProduct(
    { ...product, userLabel: label },
    lookup,
    new AbortController().signal
  );
  expect(result).toMatchObject({
    ...label,
    confidence: 0.75,
    assumptions: ['Uses the label values you provided.', ...label.assumptions]
  });
  expect(lookup).toHaveBeenCalledOnce();
});

test('a compatible catalog match retains explicit package values for resolution', async () => {
  const lookup = vi
    .fn<Lookup>()
    .mockResolvedValue({ status: 'found', food: { id: generic.foodId } });
  const signal = new AbortController().signal;
  const result = await resolveNamedProduct(
    {
      ...product,
      userLabel: {
        kind: 'estimate',
        label: product.query,
        grams: 3,
        confidence: 1,
        per100g: { omega3_epa_mg: 30000 },
        assumptions: ['Package declares 300 mg EPA per capsule.']
      }
    },
    lookup,
    signal
  );
  expect(lookup).toHaveBeenCalledExactlyOnceWith(product.query, signal, {
    requireExactIdentity: true
  });
  expect(proposalSchema.parse({ ...base, items: [result] }).items[0]).toMatchObject({
    kind: 'food',
    foodId: generic.foodId,
    labelPer100g: { omega3_epa_mg: 30000 },
    assumptions: [expect.stringContaining('label values'), expect.any(String)]
  });
});
