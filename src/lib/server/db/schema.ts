import { sql } from 'drizzle-orm';
import { mealTypes } from '../../meal-types.ts';
import type { CatalogClassification, DietaryAmounts } from '../nutrition/dietary.ts';
import type { IngredientEvidence } from '../nutrition/ingredient-evidence.ts';
import type { NutrientAmounts } from '../nutrition/amounts.ts';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const foodKind = pgEnum('food_kind', ['generic', 'branded', 'dish', 'custom']);
export const datasetStatus = pgEnum('dataset_status', ['running', 'complete', 'failed']);
export const unitDimension = pgEnum('unit_dimension', ['mass', 'volume']);

export const nutrients = pgTable('nutrients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  eurofirCode: text('eurofir_code'),
  category: text('category').notNull(),
  displayOrder: integer('display_order').notNull(),
  isCore: boolean('is_core').notNull().default(false)
});

export const foodSources = pgTable('food_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  license: text('license').notNull(),
  attribution: text('attribution').notNull(),
  homepage: text('homepage').notNull(),
  version: text('version'),
  lastImportedAt: instant('last_imported_at')
});

export const datasetRuns = pgTable(
  'dataset_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id')
      .notNull()
      .references(() => foodSources.id),
    version: text('version').notNull(),
    status: datasetStatus('status').notNull().default('running'),
    startedAt: instant('started_at').notNull().defaultNow(),
    finishedAt: instant('finished_at'),
    stats: jsonb('stats').$type<Record<string, number>>(),
    error: text('error')
  },
  (table) => [index('dataset_runs_source_started_idx').on(table.sourceId, table.startedAt)]
);

export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id')
      .notNull()
      .references(() => foodSources.id),
    sourceFoodId: text('source_food_id').notNull(),
    kind: foodKind('kind').notNull(),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    brand: text('brand'),
    barcode: text('barcode'),
    category: text('category'),
    sourceVersion: text('source_version').notNull(),
    searchText: text('search_text').notNull(),
    densityGPerMl: doublePrecision('density_g_per_ml'),
    classification: jsonb('classification').$type<CatalogClassification>(),
    favorite: boolean('favorite').notNull().default(false)
  },
  (table) => [
    unique('foods_source_identity_key').on(table.sourceId, table.sourceFoodId),
    index('foods_barcode_idx')
      .on(table.barcode)
      .where(sql`${table.barcode} is not null`),
    index('foods_search_fts_idx').using('gin', sql`to_tsvector('simple', search_text)`),
    index('foods_search_trgm_idx').using('gin', table.searchText.op('gin_trgm_ops')),
    check('foods_density_positive', sql`${table.densityGPerMl} > 0`)
  ]
);

export const foodNutrients = pgTable(
  'food_nutrients',
  {
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    nutrientId: text('nutrient_id')
      .notNull()
      .references(() => nutrients.id),
    amount: doublePrecision('amount'),
    unit: text('unit').notNull(),
    isDerived: boolean('is_derived').notNull().default(false),
    sourceMeta: jsonb('source_meta').$type<Record<string, unknown>>()
  },
  (table) => [
    primaryKey({ columns: [table.foodId, table.nutrientId] }),
    index('food_nutrients_nutrient_idx').on(table.nutrientId),
    check('food_nutrients_amount_nonnegative', sql`${table.amount} >= 0`)
  ]
);

export const portions = pgTable(
  'portions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    grams: doublePrecision('grams').notNull(),
    unit: text('unit').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    source: text('source').notNull(),
    sourceUrl: text('source_url')
  },
  (table) => [
    unique('portions_identity_key').on(table.foodId, table.source, table.unit, table.label),
    check('portions_grams_positive', sql`${table.grams} > 0`)
  ]
);

export const unitConversions = pgTable(
  'unit_conversions',
  {
    unit: text('unit').primaryKey(),
    dimension: unitDimension('dimension').notNull(),
    factorToBase: doublePrecision('factor_to_base').notNull()
  },
  (table) => [check('unit_conversion_factor_positive', sql`${table.factorToBase} > 0`)]
);

export const foodComponents = pgTable(
  'food_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentFoodId: uuid('parent_food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    childFoodId: uuid('child_food_id').references(() => foods.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    amountG: doublePrecision('amount_g'),
    rawAmountG: doublePrecision('raw_amount_g'),
    depth: integer('depth').notNull(),
    sortOrder: integer('sort_order').notNull()
  },
  (table) => [
    unique('food_components_order_key').on(table.parentFoodId, table.sortOrder),
    index('food_components_child_idx').on(table.childFoodId),
    check(
      'food_components_weights_nonnegative',
      sql`${table.amountG} >= 0 and ${table.rawAmountG} >= 0`
    ),
    check('food_components_depth_nonnegative', sql`${table.depth} >= 0`)
  ]
);

export const foodAliases = pgTable(
  'food_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    language: text('language').notNull().default('und'),
    source: text('source').notNull()
  },
  (table) => [
    unique('food_aliases_identity_key').on(table.foodId, table.alias, table.language, table.source),
    index('food_aliases_alias_idx').on(table.alias)
  ]
);

export const productIngredients = pgTable('product_ingredients', {
  foodId: uuid('food_id')
    .primaryKey()
    .references(() => foods.id, { onDelete: 'cascade' }),
  foodVersion: text('food_version').notNull(),
  evidence: jsonb('evidence').$type<IngredientEvidence>(),
  sourceUrl: text('source_url'),
  labelNutrients: jsonb('label_nutrients').$type<{ sourceUrl: string; values: NutrientAmounts }>(),
  checkedAt: instant('checked_at').notNull().defaultNow()
});

export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    servings: doublePrecision('servings').notNull(),
    totalWeightG: doublePrecision('total_weight_g'),
    instructions: text('instructions'),
    searchText: text('search_text').notNull()
  },
  (table) => [
    check('recipes_servings_positive', sql`${table.servings} > 0`),
    check('recipes_weight_positive', sql`${table.totalWeightG} > 0`)
  ]
);

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    foodId: uuid('food_id').references(() => foods.id),
    subRecipeId: uuid('sub_recipe_id').references((): AnyPgColumn => recipes.id),
    name: text('name').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    unit: text('unit').notNull(),
    grams: doublePrecision('grams').notNull(),
    optional: boolean('optional').notNull().default(false),
    sortOrder: integer('sort_order').notNull()
  },
  (table) => [
    unique('recipe_ingredients_order_key').on(table.recipeId, table.sortOrder),
    index('recipe_ingredients_food_idx').on(table.foodId),
    index('recipe_ingredients_sub_recipe_idx').on(table.subRecipeId),
    check(
      'recipe_ingredients_one_reference',
      sql`num_nonnulls(${table.foodId}, ${table.subRecipeId}) = 1`
    ),
    check('recipe_ingredients_no_self_reference', sql`${table.recipeId} <> ${table.subRecipeId}`),
    check('recipe_ingredients_amounts_positive', sql`${table.quantity} > 0 and ${table.grams} > 0`)
  ]
);

export const meal = pgEnum('meal', mealTypes);
export const entryStatus = pgEnum('entry_status', ['active', 'undone', 'deleted']);
export const itemKind = pgEnum('item_kind', ['food', 'recipe', 'dish_adjustment', 'estimate']);
export const provenance = pgEnum('provenance', ['catalog', 'recipe', 'estimate', 'corrected']);
export const messageRole = pgEnum('message_role', ['user', 'assistant']);
export const runStatus = pgEnum('run_status', ['running', 'complete', 'clarification', 'failed']);
export const llmProvider = pgEnum('llm_provider', ['codex', 'fake']);

export const profiles = pgTable(
  'profiles',
  {
    id: integer('id').primaryKey().default(1),
    timezone: text('timezone').notNull().default('Europe/Stockholm'),
    locale: text('locale').notNull().default('en'),
    autoCommit: boolean('auto_commit').notNull().default(true),
    estimateKcalThreshold: doublePrecision('estimate_kcal_threshold').notNull().default(200),
    provider: llmProvider('provider'),
    model: text('model')
  },
  (table) => [
    check('profiles_singleton', sql`${table.id} = 1`),
    check('profiles_estimate_threshold_nonnegative', sql`${table.estimateKcalThreshold} >= 0`)
  ]
);

export const goals = pgTable(
  'goals',
  {
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id),
    effectiveFrom: date('effective_from').notNull(),
    kcal: doublePrecision('kcal'),
    proteinG: doublePrecision('protein_g'),
    fatG: doublePrecision('fat_g'),
    carbsG: doublePrecision('carbs_g'),
    fiberG: doublePrecision('fiber_g')
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.effectiveFrom] }),
    check(
      'goals_nonnegative',
      sql`${table.kcal} >= 0 and ${table.proteinG} >= 0 and ${table.fatG} >= 0 and ${table.carbsG} >= 0 and ${table.fiberG} >= 0`
    )
  ]
);

export const chatThreads = pgTable('chat_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  date: date('log_date').unique(),
  archivedAt: instant('archived_at'),
  summary: text('summary'),
  summaryUpdatedAt: instant('summary_updated_at'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow()
});

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    provider: llmProvider('provider').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version').notNull(),
    toolCalls: jsonb('tool_calls').$type<string[]>().notNull().default([]),
    tokens: jsonb('tokens').$type<{ input?: number; output?: number }>(),
    latencyMs: integer('latency_ms'),
    status: runStatus('status').notNull().default('running'),
    errorCategory: text('error_category'),
    createdAt: instant('created_at').notNull().defaultNow()
  },
  (table) => [index('agent_runs_thread_idx').on(table.threadId)]
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id),
    role: messageRole('role').notNull(),
    content: text('content').notNull(),
    parts: jsonb('parts').$type<unknown[]>().notNull().default([]),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    createdAt: instant('created_at').notNull().defaultNow()
  },
  (table) => [
    index('chat_messages_thread_created_idx').on(table.threadId, table.createdAt),
    index('chat_messages_run_idx').on(table.agentRunId),
    index('chat_messages_content_fts_idx').using('gin', sql`to_tsvector('simple', content)`)
  ]
);

export const logEntries = pgTable(
  'log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: integer('profile_id')
      .notNull()
      .default(1)
      .references(() => profiles.id),
    loggedAt: instant('logged_at').notNull(),
    meal: meal('meal').notNull().default('other'),
    title: text('title'),
    rawText: text('raw_text').notNull(),
    sourceMessageId: uuid('source_message_id').references(() => chatMessages.id),
    status: entryStatus('status').notNull().default('active'),
    confidence: doublePrecision('confidence').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow()
  },
  (table) => [
    index('log_entries_profile_logged_idx').on(table.profileId, table.loggedAt),
    index('log_entries_source_message_idx').on(table.sourceMessageId),
    index('log_entries_raw_text_fts_idx').using('gin', sql`to_tsvector('simple', raw_text)`),
    check('log_entries_confidence_range', sql`${table.confidence} between 0 and 1`)
  ]
);

export const logEntryItems = pgTable(
  'log_entry_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => logEntries.id),
    kind: itemKind('kind').notNull(),
    foodId: uuid('food_id').references(() => foods.id),
    recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    unit: text('unit').notNull(),
    grams: doublePrecision('grams').notNull(),
    provenance: provenance('provenance').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    assumptions: jsonb('assumptions').$type<string[]>().notNull().default([]),
    resolution: jsonb('resolution').$type<Record<string, unknown>>().notNull(),
    dietary: jsonb('dietary').$type<DietaryAmounts>(),
    removedAt: instant('removed_at')
  },
  (table) => [
    index('log_entry_items_entry_idx').on(table.entryId),
    index('log_entry_items_food_idx').on(table.foodId),
    index('log_entry_items_recipe_idx').on(table.recipeId),
    check('log_entry_items_amounts_positive', sql`${table.quantity} > 0 and ${table.grams} > 0`),
    check('log_entry_items_confidence_range', sql`${table.confidence} between 0 and 1`)
  ]
);

export const logItemNutrients = pgTable(
  'log_item_nutrients',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => logEntryItems.id),
    nutrientId: text('nutrient_id')
      .notNull()
      .references(() => nutrients.id),
    amount: doublePrecision('amount'),
    unit: text('unit').notNull(),
    isEstimate: boolean('is_estimate').notNull().default(false)
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.nutrientId] }),
    index('log_item_nutrients_nutrient_idx').on(table.nutrientId),
    check('log_item_nutrients_amount_nonnegative', sql`${table.amount} >= 0`)
  ]
);

export const logEntryRevisions = pgTable(
  'log_entry_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => logEntries.id),
    action: text('action').notNull(),
    previous: jsonb('previous').$type<Record<string, unknown>>().notNull(),
    createdAt: instant('created_at').notNull().defaultNow()
  },
  (table) => [index('log_entry_revisions_entry_idx').on(table.entryId, table.createdAt)]
);
