export const foodGroups = {
  vegetables: 'Vegetables',
  fruitAndBerries: 'Fruit and berries',
  wholeGrains: 'Whole grains',
  legumes: 'Legumes',
  nutsAndSeeds: 'Nuts and seeds',
  oilyFish: 'Oily fish',
  redMeat: 'Red meat',
  processedMeat: 'Processed meat'
} as const;

export type FoodGroup = keyof typeof foodGroups;
export const foodGroupIds = Object.keys(foodGroups) as FoodGroup[];

export const novaGroups = [1, 2, 3, 4] as const;
export type NovaGroup = (typeof novaGroups)[number];
