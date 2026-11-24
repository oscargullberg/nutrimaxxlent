# Nutrimaxxlent architecture

Nutrimaxxlent is a single-user nutrition log for localhost. A SvelteKit SPA and its local JSON
and streaming APIs run in one Node process via `adapter-node`. PostgreSQL 18 stores the food
catalog, recipes, meal logs, chat history, and profile settings. Docker Compose runs Postgres
with `pg_trgm` and `unaccent` for catalog and history search.

## Code map

| Area                | Entry points                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser             | [SvelteKit pages](../../src/routes/) for Today, Foods, Recipes, and Settings. Today opens by default and embeds [meal chat](../../src/lib/components/MealChat.svelte) for the selected date. The same component renders older conversations under Chat history. The [API client](../../src/lib/client/api.ts) handles JSON and chat events. |
| HTTP and startup    | [API routes](../../src/routes/api/) parse requests and delegate to [services](../../src/lib/server/services/). [Server hooks](../../src/hooks.server.ts) verify database readiness, enforce `ORIGIN` on API writes, and attach request IDs.                                                                                                 |
| Meal interpretation | [Chat orchestration](../../src/lib/server/services/chat.ts) manages turns and commits. The [agent](../../src/lib/server/agent/) handles pre-search, provider calls, proposal validation, and clarification. [Nutrition functions](../../src/lib/server/nutrition/) handle amounts, dishes, recipe rollups, and snapshots.                   |
| Storage and catalog | [Drizzle schema](../../src/lib/server/db/schema.ts) and [migrations](../../drizzle/) define persistence. The [catalog CLI](../../scripts/catalog.ts) downloads and refreshes source data through [importers](../../src/lib/server/importers/).                                                                                              |

## From a meal to daily totals

1. Today loads the selected date's thread on opening **+ Log** and creates it on the first
   message. A nullable unique date on the thread keeps daily conversations separate and preserves
   older, undated conversations. The server assigns committed entries to the thread's date in
   the profile timezone. Chat posts a new turn or a reply to a clarification or confirmation. The Node process runs one
   turn per thread and saves the user message before resolving it. The messages route streams
   progress independently of the turn's lifetime. A reopened thread checks for the active turn
   until the reply is saved. For a new turn, local pre-search finds candidates and the bounded
   agent loop uses the configured provider to interpret the message. A normal turn sends compact
   catalog candidates. A leftover reference can load whole recent meals with their food and recipe
   IDs, using the profile's local date for references to yesterday. The server resolves named
   products from that proposal before calculating nutrition. It checks the local catalog, looks up
   missing product labels and saves verified matches with their portions and documented nutrients.
   For labels declared by volume, volume entries scale the published values directly. When
   density is estimated, the entry identifies the weight conversion as an estimate and flags
   label nutrients as estimated for weight-based entries.
   Explicit package nutrient values supplied by the user take precedence for the current log.
   Missing values can come from a compatible catalog match. For ordinary branded foods, the server
   also saves the ingredient declaration for reuse. A label supplied
   in chat can correct the saved ingredients for that product. Cached products with no usable
   declaration can retry lookup after a day. The resolver matches ingredients against the local food
   catalog and uses the label to constrain possible proportions. It fills missing nutrients when
   the plausible proportions give a sufficiently narrow range.
   If the selected variant's lookup is inconclusive, chat offers the generic substitute for
   ordinary food when one is available, with confirmation before logging. It asks for more label
   information when a suitable substitute is unavailable.
   Explicit meal headings divide a message into sections before interpretation. Each section
   resolves independently. One review retains the item's meal assignment, and the server commits
   a separate entry for each section in the same transaction.
2. The server validates the structured proposal against local data and resolves grams and
   nutrients. When a matched catalog food lacks a conversion for a piece, serving, household
   measure or volume, [portion lookup](../../src/lib/server/agent/portion-lookup.ts) can resolve
   grams per unit and save the weight for that food and unit. The provider can return a cited
   weight or a typical estimate. Imported and personal conversions take precedence, and a
   sourced piece weight can also be reused for a serving when the evidence supports it.
   Chat saves pending review state in message parts and includes the active draft in the context
   for free-text follow-ups. Informational replies point back to the same draft. Edits address
   individual draft items and keep the other items and review decisions. When review is
   complete, auto-commit or explicit confirmation saves the entry and assistant reply together.
   Confirmation reuses the preview's resolved values for unchanged items. Older drafts without
   a resolved preview can still be resolved on confirmation.
   Review submissions can replace individual proposal items with catalog foods or saved recipes.
   Stop targets the active turn by ID and records a stopped reply. If Node restarts before the
   reply is saved, the accepted message remains in history and the user can retry it. A stopped
   or interrupted review answer leaves the original prompt available.
3. Manual logging and chat share [entry persistence](../../src/lib/server/services/entries.ts).
   Log items store resolved amounts, nutrient snapshots with per-value estimate flags, and food
   classification snapshots.
   The resolver scales catalog classifications and rolls up recipe ingredients using the same
   serving and adjustment rules as nutrition. Edits to logged
   items, including replacements, update their snapshots and record revisions. Undo and deletion change entry status.
   Chat proposes a short title in the same call that interprets the meal. The draft and entry
   retain the title, and the list can use the meal category when a useful title is missing.
   Portion-only changes preserve the title. Today supports renaming and splitting older merged
   entries while preserving their item IDs and nutrient snapshots.
4. [Totals](../../src/lib/server/services/totals.ts) group active entries by the profile
   timezone and aggregate snapshots for items still included in the log. Catalog refreshes
   replace the portions from their own source and preserve learned and personal portions.
   Previous entries retain their saved values. Today displays the daily totals and coverage
   together with the matching day's entries. Nutrient details rank contributors from the entries'
   saved item values and show the estimated contribution to the total.

## Integrations and specifications

- The default Codex provider reads the local CLI session and sends bounded context during
  normal chat. The fake provider supports deterministic tests. See [LLM provider](../llm-provider.md).
- Bulk imports populate the local catalog from Livsmedelsverket, USDA FoodData Central, and
  a Swedish Open Food Facts subset. Livsmedelsverket dishes and USDA FNDDS reference recipes
  link to ingredients and store weighted food-group rollups. See
  [food data sources](../data-sources.md) for import, dietary backfill, and attribution details.
- See the [data model](../data-model.md), [API reference](../api.md), and [UI guide](../ui.md)
  for subsystem details. The [README](../../README.md) covers local setup, backup, and tests.
- [OpenSpec main specs](../../openspec/specs/) currently has no published specs. Capability
  specs and implementation tasks are in the
  [nutrition logging change](../../openspec/changes/add-nutrition-logging-app/).
