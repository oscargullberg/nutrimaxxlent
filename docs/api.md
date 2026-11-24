# Local API

The UI and API share the configured local origin. Send JSON to mutating routes and include that origin in the `Origin` header. The API returns an `X-Request-ID` header for troubleshooting. UUID path parameters identify resources.

| Method and path                                       | Purpose                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /api/threads`                                    | List undated threads. Use `?date=YYYY-MM-DD` for that day's thread and `archived=true` to include archived threads.   |
| `POST /api/threads`                                   | Create an undated thread with an optional `title`, or get or create the thread for a supplied `date`.                 |
| `GET /api/threads/[id]`                               | Read a thread.                                                                                                        |
| `PATCH /api/threads/[id]`                             | Change the `title` or `archived` flag.                                                                                |
| `DELETE /api/threads/[id]`                            | Archive a thread. Use `?permanent=true` to delete its history and keep its logged meals.                              |
| `GET /api/threads/[id]/messages`                      | Read recent messages and the active, pending review, or interrupted turn IDs.                                         |
| `POST /api/threads/[id]/messages`                     | Start a server-owned chat turn or answer a pending prompt. Streams events while connected.                            |
| `DELETE /api/threads/[id]/messages?turn=<uuid>`       | Stop the matching active turn. Returns 204 if that turn has already ended.                                            |
| `GET /api/search?q=...`                               | Search past messages and active entries.                                                                              |
| `GET /api/entries?date=YYYY-MM-DD`                    | List active entries with item snapshots. The date is optional.                                                        |
| `POST /api/entries`                                   | Log food, recipe, or estimate items with a meal type, optional `title`, and optional profile-local date or timestamp. |
| `GET /api/entries/[id]`                               | Read the entry and its current item snapshots.                                                                        |
| `PATCH /api/entries/[id]`                             | Change the `title`, meal type, profile-local date, or timestamp.                                                      |
| `POST /api/entries/[id]/split`                        | Split an active entry into named meals. Supply `groups` with a `title`, `meal`, and `itemIds` per group.              |
| `DELETE /api/entries/[id]`                            | Mark the entry deleted and exclude it from totals.                                                                    |
| `POST /api/entries/[id]/undo`                         | Undo an entry and exclude it from totals.                                                                             |
| `PATCH /api/entries/[id]/items/[itemId]`              | Replace an item or edit its quantity, unit, grams, or estimate values.                                                |
| `DELETE /api/entries/[id]/items/[itemId]`             | Remove one item from the entry.                                                                                       |
| `GET /api/totals/day?date=YYYY-MM-DD`                 | Read daily nutrient and food classification totals, grouped meals, and effective goals.                               |
| `GET /api/totals/range?from=YYYY-MM-DD&to=YYYY-MM-DD` | Read up to 31 days of totals and effective goals.                                                                     |
| `GET /api/foods?q=...&source=...&limit=...`           | Search foods. The source and limit are optional.                                                                      |
| `POST /api/foods`                                     | Create a user food with a name and canonical `per100g` nutrient values.                                               |
| `GET /api/foods/[id]`                                 | Read a food with nutrients, portions, and components.                                                                 |
| `PATCH /api/foods/[id]`                               | Set a favorite or a personal `portionG`. Optional `portionUnit` selects the unit and defaults to `portion`.           |
| `GET /api/recipes?q=...`                              | List or search personal recipes.                                                                                      |
| `POST /api/recipes`                                   | Create a recipe with servings and resolved ingredients.                                                               |
| `GET /api/recipes/[id]`                               | Read a recipe and calculated nutrients.                                                                               |
| `PATCH /api/recipes/[id]`                             | Replace the recipe definition.                                                                                        |
| `DELETE /api/recipes/[id]`                            | Delete an unreferenced recipe.                                                                                        |
| `GET /api/settings`                                   | Read the profile, effective goals, local date, and provider configuration.                                            |
| `PATCH /api/settings`                                 | Update profile preferences and goals.                                                                                 |
| `GET /api/provider/status`                            | Read local credential status and configured model.                                                                    |
| `POST /api/provider/test`                             | Run a synthetic connection test.                                                                                      |
| `GET /api/meta/sources`                               | Read imported source attribution and revision details.                                                                |
| `GET /api/export`                                     | Download a JSON copy of local user data.                                                                              |

## Chat events

Send `{"kind":"message","text":"150 g of rice"}` to start a turn. An optional client-generated `messageId` guards against submitting the same message twice. For a pending clarification, send `{"kind":"clarify","replyTo":"<assistant message UUID>","selection":{"optionId":"option-1"}}`. If the question asks for grams, supply `{"grams":150}` as the selection. To commit a pending draft, send `{"kind":"confirm","replyTo":"<assistant message UUID>"}`.

For a meal review, submit the item answers together with
`{"kind":"clarify","replyTo":"<assistant message UUID>","selection":{"answers":[{"itemIndex":0,"optionId":"option-1"},{"itemIndex":1,"grams":145}]}}`.
The review includes the resolved preview items and any further questions in `clarification.additional`.
Both `clarify` and `confirm` accept a `replacements` array. Each element has an `itemIndex` and a `replacement` object. The replacement is a catalog food (`kind`, `foodId`, `quantity`, `unit`) or saved recipe (`kind`, `recipeId`, `servings`). Leave replaced items out of `selection.answers`. Use the same `replacement` object to replace a logged item with the item PATCH route.

The server replies with `text/event-stream`. Each event has an `event` line and a JSON `data` line followed by a blank line.
Disconnecting from the stream leaves the turn running. The messages GET response includes
`activeTurnId`, `pendingMessageId`, and `interruptedTurnId` so clients can recover the view.
A concurrent turn in the same thread receives `CHAT_BUSY`.
Entries committed by a dated thread belong to that date in the profile timezone.
A message with several meal headings can produce several `committed` events. The entries are
committed together after any required review. Splitting an older entry moves its saved items
between meals and keeps the nutrient snapshots attached to those items.

| Event           | Data                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| `message`       | A persisted user or assistant message.                                                      |
| `text`          | An assistant text delta.                                                                    |
| `tool`          | The tool name.                                                                              |
| `proposal`      | A resolved preview with an optional `title`, assistant reply, and confirmation requirement. |
| `clarification` | A question and options with an assistant message ID.                                        |
| `draft`         | The assistant message ID for a pending confirmation.                                        |
| `committed`     | The persisted entry and nutrient snapshots.                                                 |
| `done`          | The thread ID and a completed turn.                                                         |
| `error`         | A structured error. Terminates the stream.                                                  |

JSON errors and stream errors contain `{"error":{"code":"INVALID_INPUT","message":"…","requestId":"…"}}`. Codes include `INVALID_ORIGIN`, `INVALID_INPUT`, `NOT_FOUND`, `CHAT_CONFLICT`, `INVALID_PROPOSAL`, `CATALOG_EMPTY`, `UNIT_UNRESOLVED`, `PROVIDER_NOT_CONNECTED`, `PROVIDER_MODEL_UNAVAILABLE`, `PROVIDER_RATE_LIMITED`, `AGENT_TIMEOUT`, `AGENT_STEP_LIMIT`, and `AGENT_TOOL_LIMIT`.
