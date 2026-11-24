import { foodGroupIds, novaGroups, type FoodGroup, type NovaGroup } from '../../food-groups.ts';

type GroupAmount = { grams: number; partial?: true };

export type DietaryAmounts = {
  groups: Partial<Record<FoodGroup, GroupAmount>>;
  /** True only when every food group is explicitly classified, including known zeros. */
  groupsKnown?: boolean;
  novaGrams: Partial<Record<NovaGroup, number>>;
  unknownNovaG: number;
  novaSources: string[];
};

export type CatalogClassification = Record<string, unknown> & {
  dietary?: DietaryAmounts;
  dietaryComponents?: {
    cookedGrams: number;
    useComponentNova: boolean;
    leaves: { sortOrder: number; dietary: DietaryAmounts }[];
  };
};

export function unknownDietary(grams: number): DietaryAmounts {
  return { groups: {}, groupsKnown: false, novaGrams: {}, unknownNovaG: grams, novaSources: [] };
}

export function withNova(
  dietary: DietaryAmounts,
  grams: number,
  group?: NovaGroup,
  source?: string
): DietaryAmounts {
  return {
    ...dietary,
    novaGrams: group ? { [group]: grams } : {},
    unknownNovaG: group ? 0 : grams,
    novaSources: source ? [source] : []
  };
}

export function scaleDietary(dietary: DietaryAmounts, factor: number): DietaryAmounts {
  const groups: DietaryAmounts['groups'] = {};
  for (const id of foodGroupIds) {
    const amount = dietary.groups[id];
    if (amount) groups[id] = { ...amount, grams: amount.grams * factor };
  }
  const novaGrams: DietaryAmounts['novaGrams'] = {};
  for (const group of novaGroups) {
    const amount = dietary.novaGrams[group];
    if (amount !== undefined) novaGrams[group] = amount * factor;
  }
  return { ...dietary, groups, novaGrams, unknownNovaG: dietary.unknownNovaG * factor };
}

export function sumDietary(items: readonly DietaryAmounts[]): DietaryAmounts {
  const groups: DietaryAmounts['groups'] = {};
  for (const id of foodGroupIds) {
    let grams = 0;
    let known = 0;
    let partial = false;
    for (const item of items) {
      const amount = item.groups[id];
      if (!amount) continue;
      grams += amount.grams;
      known++;
      partial ||= Boolean(amount.partial);
    }
    if (known > 0)
      groups[id] = { grams, ...(partial || known < items.length ? { partial: true } : {}) };
  }

  const result: DietaryAmounts = {
    groups,
    groupsKnown: items.length > 0 && items.every((item) => item.groupsKnown === true),
    novaGrams: {},
    unknownNovaG: 0,
    novaSources: []
  };
  const sources = new Set<string>();
  for (const item of items) {
    for (const group of novaGroups) {
      const amount = item.novaGrams[group];
      if (amount !== undefined) result.novaGrams[group] = (result.novaGrams[group] ?? 0) + amount;
    }
    result.unknownNovaG += item.unknownNovaG;
    for (const source of item.novaSources) sources.add(source);
  }
  result.novaSources = [...sources];
  return result;
}

export function catalogDietary(classification: CatalogClassification | null, grams: number) {
  return classification?.dietary
    ? scaleDietary(classification.dietary, grams / 100)
    : unknownDietary(grams);
}

export function adjustedCatalogDietary(
  classification: CatalogClassification | null,
  grams: number,
  components: readonly { id: string; depth: number; sortOrder: number }[],
  removed: ReadonlySet<string>,
  additions: readonly { grams: number; dietary: DietaryAmounts }[],
  adjustedGrams: number
) {
  const added = additions.map((item) => scaleDietary(item.dietary, item.grams / 100));
  if (!removed.size) return sumDietary([catalogDietary(classification, grams), ...added]);
  const retainedGrams = Math.max(
    0,
    adjustedGrams - additions.reduce((sum, item) => sum + item.grams, 0)
  );
  const detail = classification?.dietaryComponents;
  if (!detail) return sumDietary([unknownDietary(retainedGrams), ...added]);

  const excluded = new Set<number>();
  let excludedDepth = Infinity;
  for (const component of components) {
    if (component.depth <= excludedDepth) {
      excludedDepth = removed.has(component.id) ? component.depth : Infinity;
    }
    if (excludedDepth !== Infinity) excluded.add(component.sortOrder);
  }
  const leaves = detail.leaves.filter(({ sortOrder }) => !excluded.has(sortOrder));
  if (!leaves.length && retainedGrams === 0) return sumDietary(added);
  const retained = scaleDietary(
    sumDietary(leaves.map(({ dietary }) => dietary)),
    grams / detail.cookedGrams
  );
  return sumDietary([
    detail.useComponentNova ? retained : withNova(retained, retainedGrams),
    ...added
  ]);
}
