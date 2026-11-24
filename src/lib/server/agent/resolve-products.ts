import type { AgentProposal, NamedProductItem, Proposal, ProposedItem } from './proposal.ts';
import type { createProductLookup } from './product-lookup.ts';

type LookupProduct = ReturnType<typeof createProductLookup>;

export async function resolveNamedProduct(
  item: NamedProductItem,
  lookup: LookupProduct,
  signal: AbortSignal,
  { selectedVariant = false } = {}
): Promise<ProposedItem> {
  const result =
    item.productType === 'food'
      ? await lookup(item.query, signal, {
          learnIngredients: true,
          userIngredients: item.userIngredients,
          ...(item.userLabel && { requireExactIdentity: true })
        })
      : item.userLabel
        ? await lookup(item.query, signal, { requireExactIdentity: true })
        : await lookup(item.query, signal);
  if (result.status === 'found') {
    const label = item.userLabel;
    return {
      kind: 'food',
      foodId: result.food.id,
      quantity: item.quantity,
      unit: item.unit,
      confidence: 1,
      assumptions: label
        ? ['Uses the label values you provided.', ...label.assumptions.slice(0, 11)]
        : [],
      ...(label && { labelPer100g: label.per100g })
    };
  }
  if (item.userLabel) {
    return {
      ...item.userLabel,
      confidence: Math.min(item.userLabel.confidence, 0.75),
      assumptions: [
        'Uses the label values you provided.',
        ...item.userLabel.assumptions.slice(0, 11)
      ]
    };
  }
  if (result.status === 'ambiguous' && !selectedVariant) {
    return {
      kind: 'clarify',
      question: `Which variant of ${item.query} did you have?`,
      phrase: item.query,
      options: result.alternatives.map((query) => ({
        label: query,
        selection: {
          kind: 'product_variant',
          query,
          quantity: item.quantity,
          unit: item.unit,
          productType: item.productType,
          ...(item.productType === 'food' && item.fallback ? { fallback: item.fallback } : {})
        }
      }))
    };
  }
  if (item.productType === 'food' && item.fallback) {
    const fallback = item.fallback;
    return {
      ...fallback,
      confidence: Math.min(fallback.confidence, 0.75),
      assumptions: [
        'The exact product could not be verified. This is a generic substitute.',
        ...fallback.assumptions.slice(0, 11)
      ]
    };
  }
  const reason =
    result.status === 'unavailable' ||
    (result.status === 'not_found' &&
      (result.reason === 'web_search_not_run' || result.reason === 'web_search_failed'))
      ? 'The online lookup was unavailable.'
      : 'I couldn’t verify the product label online.';
  return {
    kind: 'clarify',
    question: `${reason} What’s the exact variant, barcode, or serving and nutrition information on the label for ${item.query}?`,
    phrase: item.query,
    options: []
  };
}

export async function resolveNamedProducts(
  proposal: AgentProposal,
  lookup: LookupProduct,
  signal: AbortSignal
): Promise<Proposal> {
  const hasProduct = proposal.items.some(({ kind }) => kind === 'product');
  const items = await Promise.all(
    proposal.items.map((item) =>
      item.kind === 'product' ? resolveNamedProduct(item, lookup, signal) : item
    )
  );
  const needsClarification = items.some(({ kind }) => kind === 'clarify');
  return {
    ...proposal,
    items,
    needsClarification: hasProduct ? needsClarification : proposal.needsClarification,
    reply:
      hasProduct && needsClarification
        ? 'I need a detail before I can log the meal.'
        : proposal.reply
  };
}
