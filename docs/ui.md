# Using Nutrimaxxlent

The navigation contains four pages. Today opens by default.

- **Today.** Use the date field or arrows to review a day in your profile timezone. **+ Log** opens the conversation for that date. Describe a meal in your own words or choose **Add food manually** to use the catalog or a saved recipe. Chat shows matches, assumptions, and any items that need confirmation. The summary shows calories, macros, and fiber against daily references or personal goals. **All nutrients** shows the full searchable breakdown on days with logged items. A dashed track indicates missing data or a missing numeric target. Choose a nutrient to see its reference, data coverage, estimates, and top food contributors. **No data** means no logged item has a value. **0** means the reported amounts sum to zero. Partial data shows how many items have values. Expand **Food groups** for ingredient totals and ultra-processed food (NOVA 4).
- **Foods.** Search by name, brand, or barcode. Filter by source and open a food to see portions, nutrients, and any ingredient tree. Save a favorite or your own serving amount, or log directly. Use **Add custom food** for label values you want to keep locally.
- **Recipes.** Create a recipe from foods and saved recipes. Set quantities, servings, and optional ingredients. The detail view shows per-serving nutrients and offers direct logging.
- **Settings.** Configure the provider and test the connection, set effective nutrient goals and preferences, review dataset attribution, and export a JSON copy of your data.

Chat continues processing when you close the panel or navigate away. Reopen **+ Log** for the
same date to see progress or the saved result. **Stop** ends the current turn. If a server restart
interrupts a turn, use **Retry message** or answer the restored review prompt. Open **Chat history**
from the log panel to browse older conversations or search past messages and meals. On narrow
screens, select **Threads** to expand that conversation list and search field.

Use separate headings such as **Breakfast**, **Lunch**, and **Dinner** to log several meals
in one message. You can also give a section a name such as **McD dinner**. The review keeps the
foods under their original meal headings. If an older entry combined several sections, open
**Entry actions** and choose **Split meal** to assign its saved foods to the correct meals.

Choose a food name on a meal card to replace it or use **Edit portion** to change its amount.
**Item details** shows the source,
assumptions, and the option to remove the item. Open **Entry actions** to rename, move, or delete the entry.

## Keyboard

- **Enter** sends from the chat composer. **Shift+Enter** inserts a line break.
- **Enter** submits a search from its search field.
- **Escape** closes a dialog. The dialog initially focuses the relevant input and returns focus to the button that opened it.
- Use **Tab** to reach navigation, controls, and actions. The first Tab from the page offers **Skip to content**.

If the catalog is empty, the Foods page shows the import command. If Codex is disconnected, Settings shows the sign-in command and a connection test. Request errors show their code and a retry action.

## Visual system

Shared colors, typography, controls, and surfaces live in [`src/app.css`](../src/app.css). Charcoal surfaces and acid green carry the poster style. Lime marks primary actions and protein, amber marks carbohydrates, violet marks fat, and mint marks fiber. Nutrient rows label the values directly. Condensed headings use system fonts, and figures use tabular numerals.

The Chat history header uses a faint stencil texture on its right edge. Forms, log entries, and nutrient details use solid surfaces. The site navigation moves below the wordmark on narrow screens.
