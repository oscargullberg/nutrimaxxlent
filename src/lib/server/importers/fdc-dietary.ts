import { foodGroupIds, type FoodGroup } from '../../food-groups.ts';
import { scaleDietary, sumDietary, unknownDietary, withNova } from '../nutrition/dietary.ts';

type Ingredient = { code: number; name: string; grams: number | null };
export type FdcDietaryFood = {
  id: string;
  name: string;
  category?: string;
  ingredients?: Ingredient[];
  moistureChange?: number;
};

function classifyIngredient(name: string, category?: string) {
  const dietary = unknownDietary(100);
  const description = name.toLowerCase();
  // These categories can contain prepared foods. Only count identifiable plain ingredients.
  const plain =
    !/\b(?:breaded|battered|flavored|sauce|soup|salad|dressing|sandwich|mixed with|with added|stuffed|creamed)\b/u.test(
      description
    );
  const simplePreparation =
    /\b(?:raw|fresh|frozen|cooked|boiled|steamed|dried|dry|roasted)\b/u.test(description);
  let group: FoodGroup | undefined;

  if (
    /^pork, cured\b/u.test(description) ||
    (category === 'Sausages and Luncheon Meats' &&
      /^(?:bacon|salami|pepperoni|(?:pork|beef|turkey|chicken) sausage)\b/u.test(description))
  ) {
    // A cured product contributes its full weight to processed meat. The red meat fraction can vary.
    dietary.groups.processedMeat = { grams: 100 };
    return dietary;
  }
  if (!plain) return dietary;

  if (
    ['Beef Products', 'Pork Products', 'Lamb, Veal, and Game Products'].includes(category ?? '') &&
    /^(?:beef|pork|lamb|veal|game meat|bison|venison|goat), /u.test(description) &&
    simplePreparation &&
    !/\b(?:cured|luncheon|sausages?|smoked|marinated|seasoned|with solution)\b/u.test(description)
  ) {
    group = 'redMeat';
  } else if (
    category === 'Vegetables and Vegetable Products' &&
    simplePreparation &&
    !/\b(?:potato(?:es)?|yam|cassava|beans|lentils|chickpeas|peas|juice|oil|fried)\b/u.test(
      description
    )
  ) {
    group = 'vegetables';
  } else if (
    category === 'Fruits and Fruit Juices' &&
    simplePreparation &&
    !/\b(?:juice|nectar|sugar|sweetened|syrup|oil)\b/u.test(description)
  ) {
    group = 'fruitAndBerries';
  } else if (
    category === 'Legumes and Legume Products' &&
    /^(?:beans|lentils|chickpeas|cowpeas|peas|soybeans)\b/u.test(description) &&
    simplePreparation
  ) {
    group = 'legumes';
  } else if (
    (category === 'Nut and Seed Products' || category === 'Legumes and Legume Products') &&
    /^(?:nuts,|seeds,|peanuts,) /u.test(description) &&
    simplePreparation &&
    !/\b(?:butter|flour|oil|sweetened|coated)\b/u.test(description)
  ) {
    group = 'nutsAndSeeds';
  } else if (
    category === 'Finfish and Shellfish Products' &&
    /^fish, (?:salmon|mackerel|sardine|herring|trout|eel|anchovy),/u.test(description) &&
    simplePreparation
  ) {
    group = 'oilyFish';
  } else if (
    ['Cereal Grains and Pasta', 'Breakfast Cereals'].includes(category ?? '') &&
    /^(?:oats|cereals, oats|rice, brown|wheat flour, whole-grain|rye grain|bulgur|quinoa)\b/u.test(
      description
    ) &&
    !/\b(?:cooked|prepared|sweetened|fortified with)\b/u.test(description)
  ) {
    group = 'wholeGrains';
  } else if (
    !/^(?:salt, table|sugars, granulated|beverages, water, (?:tap|bottled)|beverages, coffee, brewed|eggs?, |milk, |cream, (?:sour|heavy)|butter, |cheese, |fast foods, potato, french fried in vegetable oil$|rice, white, |flour, wheat, all-purpose|cornstarch$|oil, (?:olive|canola|soybean|sunflower|corn),?)/u.test(
      description
    )
  ) {
    return dietary;
  }

  for (const id of foodGroupIds) dietary.groups[id] = { grams: id === group ? 100 : 0 };
  dietary.groupsKnown = true;
  return dietary;
}

function recipeYield(food: FdcDietaryFood) {
  const ingredients = food.ingredients ?? [];
  if (ingredients.some(({ grams }) => grams === null)) return 0;
  const total = ingredients.reduce((sum, { grams }) => sum + (grams ?? 0), 0);
  return total * (1 + (food.moistureChange ?? 0) / 100);
}

export function fdcFoodGroups(
  food: FdcDietaryFood,
  byCode: ReadonlyMap<number, readonly FdcDietaryFood[]>
) {
  const ingredients = food.ingredients ?? [];
  if (!ingredients.length) {
    const dietary = classifyIngredient(food.name, food.category);
    return Object.keys(dietary.groups).length ? { dietary } : {};
  }

  const components: {
    foodId?: string;
    name: string;
    depth: number;
    amountG?: number;
  }[] = [];
  const leaves: { sortOrder: number; dietary: ReturnType<typeof unknownDietary> }[] = [];
  const ancestors = new Set<string>();

  function visit(parent: FdcDietaryFood, depth: number, factor: number) {
    ancestors.add(parent.id);
    const moisture = 1 + (parent.moistureChange ?? 0) / 100;
    for (const ingredient of parent.ingredients ?? []) {
      if (ingredient.grams === 0) continue;
      const candidates = byCode.get(ingredient.code) ?? [];
      const matching = candidates.filter(
        ({ name }) => name.toLowerCase() === ingredient.name.toLowerCase()
      );
      const candidate =
        matching.length === 1 ? matching[0] : candidates.length === 1 ? candidates[0] : undefined;
      const child = candidate && !ancestors.has(candidate.id) ? candidate : undefined;
      const edibleGrams = ingredient.grams == null ? undefined : ingredient.grams * factor;
      // USDA gives moisture change for the entire recipe. Allocate it proportionally for display
      // and adjustments. Dry whole-grain weights still use the amount before moisture change.
      const amountG = edibleGrams === undefined ? undefined : edibleGrams * Math.max(0, moisture);
      const sortOrder = components.length;
      components.push({ foodId: child?.id, name: ingredient.name, depth, amountG });
      const childYield = child ? recipeYield(child) : 0;
      if (child && childYield > 0 && amountG !== undefined) {
        visit(child, depth + 1, amountG / childYield);
      } else {
        const dietary =
          child && !child.ingredients?.length && amountG !== undefined
            ? scaleDietary(classifyIngredient(child.name, child.category), amountG / 100)
            : unknownDietary(amountG ?? 0);
        if (dietary.groups.wholeGrains?.grams && edibleGrams !== undefined) {
          dietary.groups.wholeGrains.grams = edibleGrams;
        }
        leaves.push({ sortOrder, dietary });
      }
    }
    ancestors.delete(parent.id);
  }

  visit(food, 0, 1);
  const cookedGrams = recipeYield(food);
  if (cookedGrams <= 0) return { components };
  const amounts = sumDietary(leaves.map(({ dietary }) => dietary));
  return {
    components,
    dietary: withNova(scaleDietary(amounts, 100 / cookedGrams), 100),
    dietaryComponents: { cookedGrams, useComponentNova: false, leaves }
  };
}
