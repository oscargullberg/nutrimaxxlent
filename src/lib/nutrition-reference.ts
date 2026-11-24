export const canonicalNutrients = [
  { id: 'energy_kcal', name: 'Energy', unit: 'kcal', eurofirCode: 'ENERC', category: 'energy' },
  { id: 'energy_kj', name: 'Energy', unit: 'kJ', eurofirCode: 'ENERC', category: 'energy' },
  { id: 'protein_g', name: 'Protein', unit: 'g', eurofirCode: 'PROT', category: 'macro' },
  { id: 'fat_g', name: 'Fat', unit: 'g', eurofirCode: 'FAT', category: 'macro' },
  {
    id: 'saturated_fat_g',
    name: 'Saturated fat',
    unit: 'g',
    eurofirCode: 'FASAT',
    category: 'fat'
  },
  { id: 'carbs_g', name: 'Carbohydrates', unit: 'g', eurofirCode: 'CHO', category: 'macro' },
  { id: 'sugars_g', name: 'Total sugars', unit: 'g', eurofirCode: 'SUGAR', category: 'macro' },
  { id: 'fiber_g', name: 'Fibre', unit: 'g', eurofirCode: 'FIBT', category: 'macro' },
  { id: 'salt_g', name: 'Salt', unit: 'g', eurofirCode: 'NACL', category: 'mineral' },
  { id: 'sodium_mg', name: 'Sodium', unit: 'mg', eurofirCode: 'NA', category: 'mineral' },
  { id: 'potassium_mg', name: 'Potassium', unit: 'mg', eurofirCode: 'K', category: 'mineral' },
  { id: 'calcium_mg', name: 'Calcium', unit: 'mg', eurofirCode: 'CA', category: 'mineral' },
  { id: 'iron_mg', name: 'Iron', unit: 'mg', eurofirCode: 'FE', category: 'mineral' },
  { id: 'vitamin_c_mg', name: 'Vitamin C', unit: 'mg', eurofirCode: 'VITC', category: 'vitamin' },
  { id: 'vitamin_d_ug', name: 'Vitamin D', unit: 'µg', eurofirCode: 'VITD', category: 'vitamin' },
  {
    id: 'added_sugars_g',
    name: 'Added sugars',
    unit: 'g',
    eurofirCode: 'SUGAD',
    category: 'macro'
  },
  {
    id: 'monounsaturated_fat_g',
    name: 'Monounsaturated fat',
    unit: 'g',
    eurofirCode: 'FAMS',
    category: 'fat'
  },
  {
    id: 'polyunsaturated_fat_g',
    name: 'Polyunsaturated fat',
    unit: 'g',
    eurofirCode: 'FAPU',
    category: 'fat'
  },
  { id: 'trans_fat_g', name: 'Trans fat', unit: 'g', eurofirCode: null, category: 'fat' },
  { id: 'omega3_ala_g', name: 'Omega-3 ALA', unit: 'g', eurofirCode: null, category: 'fat' },
  { id: 'omega3_epa_mg', name: 'Omega-3 EPA', unit: 'mg', eurofirCode: 'F20:5', category: 'fat' },
  { id: 'omega3_dha_mg', name: 'Omega-3 DHA', unit: 'mg', eurofirCode: 'F22:6', category: 'fat' },
  { id: 'omega6_la_g', name: 'Omega-6 LA', unit: 'g', eurofirCode: 'F18:2', category: 'fat' },
  {
    id: 'vitamin_a_ug_rae',
    name: 'Vitamin A',
    unit: 'µg RAE',
    eurofirCode: 'VITA',
    category: 'vitamin'
  },
  {
    id: 'vitamin_b1_mg',
    name: 'Vitamin B1 (Thiamin)',
    unit: 'mg',
    eurofirCode: 'THIACLHCL',
    category: 'vitamin'
  },
  {
    id: 'vitamin_b2_mg',
    name: 'Vitamin B2 (Riboflavin)',
    unit: 'mg',
    eurofirCode: 'RIBF',
    category: 'vitamin'
  },
  {
    id: 'vitamin_b3_mg',
    name: 'Vitamin B3 (Niacin)',
    unit: 'mg',
    eurofirCode: 'NIA',
    category: 'vitamin'
  },
  {
    id: 'vitamin_b5_mg',
    name: 'Vitamin B5 (Pantothenic acid)',
    unit: 'mg',
    eurofirCode: null,
    category: 'vitamin'
  },
  {
    id: 'vitamin_b6_mg',
    name: 'Vitamin B6',
    unit: 'mg',
    eurofirCode: 'VITB6',
    category: 'vitamin'
  },
  {
    id: 'vitamin_b7_ug',
    name: 'Vitamin B7 (Biotin)',
    unit: 'µg',
    eurofirCode: null,
    category: 'vitamin'
  },
  {
    id: 'vitamin_b9_ug',
    name: 'Vitamin B9 (Folate)',
    unit: 'µg',
    eurofirCode: 'FOL',
    category: 'vitamin'
  },
  {
    id: 'vitamin_b12_ug',
    name: 'Vitamin B12',
    unit: 'µg',
    eurofirCode: 'VITB12',
    category: 'vitamin'
  },
  { id: 'vitamin_e_mg', name: 'Vitamin E', unit: 'mg', eurofirCode: 'VITE', category: 'vitamin' },
  { id: 'vitamin_k_ug', name: 'Vitamin K', unit: 'µg', eurofirCode: null, category: 'vitamin' },
  { id: 'magnesium_mg', name: 'Magnesium', unit: 'mg', eurofirCode: 'MG', category: 'mineral' },
  { id: 'phosphorus_mg', name: 'Phosphorus', unit: 'mg', eurofirCode: 'P', category: 'mineral' },
  { id: 'zinc_mg', name: 'Zinc', unit: 'mg', eurofirCode: 'ZN', category: 'mineral' },
  { id: 'selenium_ug', name: 'Selenium', unit: 'µg', eurofirCode: 'SE', category: 'mineral' },
  { id: 'iodine_ug', name: 'Iodine', unit: 'µg', eurofirCode: 'ID', category: 'mineral' },
  { id: 'copper_mg', name: 'Copper', unit: 'mg', eurofirCode: null, category: 'mineral' },
  { id: 'manganese_mg', name: 'Manganese', unit: 'mg', eurofirCode: null, category: 'mineral' }
] as const;

export type NutrientId = (typeof canonicalNutrients)[number]['id'];

export const trackedNutrientGroups = [
  { title: 'Energy & macros', categories: ['energy', 'macro'] },
  { title: 'Fat composition', categories: ['fat'] },
  { title: 'Vitamins', categories: ['vitamin'] },
  { title: 'Minerals', categories: ['mineral'] }
].map(({ title, categories }) => ({
  title,
  nutrients: canonicalNutrients.filter(
    ({ id, category }) => categories.includes(category) && id !== 'energy_kj' && id !== 'salt_g'
  )
}));

export const agentPortionSource = 'agent';
export const productLabelSource = 'product-label';

export const householdPortionUnits = {
  portion: 'serving',
  st: 'piece',
  slice: 'slice',
  glass: 'glass',
  bowl: 'bowl',
  mug: 'mug',
  bottle: 'bottle',
  can: 'can',
  scoop: 'scoop',
  handful: 'handful'
} as const;

export function portionUnitName(unit: string) {
  return Object.hasOwn(householdPortionUnits, unit)
    ? householdPortionUnits[unit as keyof typeof householdPortionUnits]
    : unit;
}

export const standardUnits = [
  { unit: 'g', dimension: 'mass', factorToBase: 1 },
  { unit: 'kg', dimension: 'mass', factorToBase: 1000 },
  { unit: 'hg', dimension: 'mass', factorToBase: 100 },
  { unit: 'mg', dimension: 'mass', factorToBase: 0.001 },
  { unit: 'µg', dimension: 'mass', factorToBase: 0.000001 },
  { unit: 'lb', dimension: 'mass', factorToBase: 453.59237 },
  { unit: 'oz', dimension: 'mass', factorToBase: 28.349523125 },
  { unit: 'ml', dimension: 'volume', factorToBase: 1 },
  { unit: 'cl', dimension: 'volume', factorToBase: 10 },
  { unit: 'dl', dimension: 'volume', factorToBase: 100 },
  { unit: 'l', dimension: 'volume', factorToBase: 1000 },
  { unit: 'fl oz', dimension: 'volume', factorToBase: 29.5735295625 },
  { unit: 'tbsp', dimension: 'volume', factorToBase: 15 },
  { unit: 'tsp', dimension: 'volume', factorToBase: 5 },
  { unit: 'cup', dimension: 'volume', factorToBase: 240 }
] as const;
