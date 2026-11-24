# Data model

Postgres 18 stores the catalog, recipe definitions, user logs, chat history, and agent runs. The Drizzle schema lives in `src/lib/server/db/schema.ts`.

## Migrations and seed

With Docker running, copy `.env.example` to `.env` and keep `DATABASE_URL` in sync with the Compose database settings.

```sh
docker compose up -d --wait
pnpm db:migrate
pnpm db:seed
```

After editing the schema, run `pnpm db:generate --name descriptive_name` from the project root. Review the generated SQL in `drizzle/` and apply it with `pnpm db:migrate`. Keep the migration SQL and its metadata together. The seed can be run again. It inserts missing defaults and preserves existing profile preferences and goals.

## Catalog and recipes

- `food_sources` holds attribution and last successful import information. `dataset_runs` records individual import attempts.
- `foods` has a stable source identity, optional density, and search information. `food_nutrients` stores amounts per 100 g by canonical nutrient ID. The catalog keeps kcal and kJ distinct and preserves missing values.
- `portions` holds food-specific weights. `unit_conversions` mirrors the standard factors used to convert mass to grams and volume to milliliters. Fluid ounces use US measures, and a household cup uses 240 mL. The app uses a food's density or portion weights to convert volume to grams. For pieces or servings it uses a weight for that food and portion.
- `food_components` describes each dish's components in traversal order with depth and raw and cooked weights. `food_aliases` stores source and learned names.
- `product_ingredients` stores the ingredient declaration for a branded food and source version, including the original text, catalog search names, and any documented percentages. It also records the last lookup attempt and additional label values found for an existing catalog product. A declaration supplied by the user takes precedence over a web declaration for that version. Ingredient-derived amounts are calculated when resolving a log item, using current catalog references.
- `recipe_ingredients` references a food or another recipe and stores a resolved gram weight. Recipe rollups exclude optional ingredients by default and use cooked yield when available. When an included ingredient lacks a nutrient value, the rollup leaves that nutrient unknown.
- Dish adjustments scale the published dish values to the requested weight and add or subtract known component contributions. Missing component trees produce a note and preserve the published values.

## Logs, profiles, and history

- `profiles` holds the single profile and its settings. `goals` is effective-dated. Initial targets stay unset until configured.
- `log_entries` and `log_entry_items` hold the meal and resolution details. `log_entries.title` stores the optional meal name. `log_item_nutrients` stores amounts and estimate flags per nutrient at commit time. `log_entry_items.dietary` stores food-group amounts, NOVA groups, and coverage when the item was logged. Historical totals read those snapshots. Older items without a classification snapshot contribute unknown amounts. Undo and deletion change entry status. `log_entry_revisions` records edits and other state changes.
- Day grouping uses the profile timezone. Totals sum known snapshots and retain a null when every stored amount for a nutrient is unknown.
- Removing the last item marks the entry deleted. The database retains the removed item and its snapshots.
- `chat_threads` and `chat_messages` preserve conversation history. A unique nullable `chat_threads.log_date` identifies the thread for a daily log. Undated threads remain accessible in Chat history. `agent_runs` holds model and execution metadata.
