<script lang="ts">
  import { api, problemMessage } from '../client/api';
  import { loggedNutrient, nutrientFormatter } from '../client/nutrition';
  import type { Entry, EntryItem } from '../client/types';
  import { mealSections } from '../meal-sections';
  import { maxMealTitleLength, mealTitle } from '../meal-title';
  import { mealLabels, mealTypes } from '../meal-types';
  import type { CatalogSelection } from '../server/agent/proposal';
  import ErrorNotice from './ErrorNotice.svelte';
  import Metrics from './Metrics.svelte';
  import ReplaceItem from './ReplaceItem.svelte';
  import SplitMeal from './SplitMeal.svelte';

  let {
    entry,
    onchange,
    mode = 'chat',
    date = undefined,
    onlogged = undefined,
    timezone = undefined,
    locale = undefined
  }: {
    entry: Entry;
    onchange: (entry: Entry) => void;
    mode?: 'chat' | 'today';
    date?: string;
    onlogged?: () => void;
    timezone?: string;
    locale?: string;
  } = $props();
  let replacementEditor: ReturnType<typeof ReplaceItem>;
  let splitEditor = $state<ReturnType<typeof SplitMeal>>();
  let replacementItemId: string;
  let editing = $state<string | null>(null);
  let amount = $state<number | undefined>(undefined);
  let problem = $state('');
  let notice = $state('');
  let busy = $state(false);
  let saveRecipe = $state(false);
  let actionsOpen = $state(false);
  let editingItems = $state(false);
  let recipeName = $state('');
  let number = $derived(nutrientFormatter(locale));
  let totals = $derived.by(() => {
    const values: Record<string, number> = {};
    for (const item of entry.items) {
      for (const [name, value] of Object.entries(item.nutrients)) {
        if (typeof value === 'number') values[name] = (values[name] ?? 0) + value;
      }
    }
    return values;
  });
  let canSaveRecipe = $derived(
    entry.items.every((item) => item.kind === 'food' || item.kind === 'recipe') &&
      entry.items.length > 0
  );
  let partialEnergy = $derived(
    totals.energy_kcal != null && entry.items.some((item) => item.nutrients.energy_kcal == null)
  );
  let sectionCount = $derived(
    entry.meal === 'other' && entry.items.length > 1 ? mealSections(entry.rawText).length : 0
  );
  let canSplit = $derived(sectionCount > 1 && sectionCount <= Math.min(entry.items.length, 8));

  async function mutate(path: string, method: string, data?: unknown) {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      const result = await api<{ entry: Entry }>(path, { method, data });
      onchange(result.entry);
      editing = null;
      actionsOpen = false;
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }

  function edit(item: EntryItem) {
    editing = item.id;
    amount = item.kind === 'recipe' ? item.quantity : item.grams;
  }

  function openReplacement(item: EntryItem) {
    replacementItemId = item.id;
    replacementEditor.open(item.label, item.grams);
  }

  function toggleEditItems() {
    editingItems = !editingItems;
    if (!editingItems) editing = null;
  }

  function saveItem(item: EntryItem) {
    if (amount == null || amount <= 0) return;
    return mutate(
      `/api/entries/${entry.id}/items/${item.id}`,
      'PATCH',
      item.kind === 'recipe' ? { quantity: amount } : { grams: amount }
    );
  }

  async function replaceItem(replacement: CatalogSelection) {
    busy = true;
    problem = '';
    try {
      const result = await api<{ entry: Entry }>(
        `/api/entries/${entry.id}/items/${replacementItemId}`,
        { method: 'PATCH', data: { replacement } }
      );
      editing = null;
      onchange(result.entry);
    } finally {
      busy = false;
    }
  }

  async function logAgain() {
    if (busy) return;
    busy = true;
    problem = '';
    notice = '';
    try {
      await api('/api/entries', {
        method: 'POST',
        data: {
          meal: entry.meal,
          date,
          title: entry.title ?? undefined,
          items: entry.items.map(({ resolution }) => resolution)
        }
      });
      notice = 'Logged again in Today.';
      onlogged?.();
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }

  async function makeRecipe() {
    if (busy) return;
    busy = true;
    problem = '';
    notice = '';
    try {
      await api('/api/recipes', {
        method: 'POST',
        data: {
          name: recipeName,
          servings: 1,
          ingredients: entry.items.map((item) =>
            item.kind === 'recipe'
              ? { kind: 'recipe', recipeId: item.recipeId, quantity: item.grams, unit: 'g' }
              : { kind: 'food', foodId: item.foodId, quantity: item.grams, unit: 'g' }
          )
        }
      });
      saveRecipe = false;
      recipeName = '';
      notice = 'Recipe saved.';
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }
</script>

<article
  class="log-card stack"
  class:diary-entry={mode === 'today'}
  aria-label={mode === 'today' ? 'Meal entry' : 'Logged meal'}
>
  {#if entry.status === 'active'}
    {@const singleItem = mode === 'today' && entry.items.length === 1 ? entry.items[0] : undefined}
    {@const fallback = canSplit
      ? `${sectionCount} meals`
      : entry.meal === 'other'
        ? 'Meal'
        : mealLabels[entry.meal]}
    {@const title =
      entry.title ?? mealTitle(entry.items, entry.items.length ? fallback : 'Empty entry')}
    <header>
      <div class="heading">
        <h3 aria-label={singleItem ? title : undefined}>
          {#if singleItem}
            <button
              class="entry-title"
              type="button"
              aria-label={`Replace ${singleItem.label}`}
              disabled={busy}
              onclick={() => openReplacement(singleItem)}>{title}</button
            >
          {:else}
            {title}
          {/if}
        </h3>
        {#if mode === 'today'}
          <time class="small muted" datetime={entry.loggedAt}>
            {new Date(entry.loggedAt).toLocaleTimeString(locale, {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: timezone
            })}
          </time>
        {/if}
      </div>
      {#if mode === 'chat'}
        <button
          class="button"
          type="button"
          disabled={busy}
          onclick={() => mutate(`/api/entries/${entry.id}/undo`, 'POST')}>Undo</button
        >
      {:else}
        <div class="row entry-tools">
          {#if totals.energy_kcal != null}
            <span class="entry-energy numbers">
              {loggedNutrient(totals.energy_kcal, 'kcal', number)}
              {#if partialEnergy}<small class="muted">Partial data</small>{/if}
            </span>
          {/if}
          <details class="entry-actions" bind:open={actionsOpen}>
            <summary class="button quiet" aria-label="Entry actions">⋯</summary>
            <div class="action-panel stack">
              <form
                class="stack"
                onsubmit={(event) => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget).get('title');
                  if (typeof name === 'string' && name.trim())
                    void mutate(`/api/entries/${entry.id}`, 'PATCH', { title: name });
                }}
              >
                <label>
                  Meal name
                  <input
                    name="title"
                    value={title}
                    maxlength={maxMealTitleLength}
                    required
                    disabled={busy}
                  />
                </label>
                <button class="button" type="submit" disabled={busy}>Save name</button>
              </form>
              <label>
                Move to meal
                <select
                  value={entry.meal}
                  disabled={busy}
                  onchange={(event) =>
                    mutate(`/api/entries/${entry.id}`, 'PATCH', {
                      meal: event.currentTarget.value
                    })}
                >
                  {#each mealTypes as meal (meal)}
                    <option value={meal}>{mealLabels[meal]}</option>
                  {/each}
                </select>
              </label>
              {#if canSplit}
                <button
                  class="button"
                  type="button"
                  disabled={busy}
                  onclick={() => splitEditor?.open()}>Split meal</button
                >
              {/if}
              <button
                class="button danger"
                type="button"
                disabled={busy}
                onclick={() => mutate(`/api/entries/${entry.id}`, 'DELETE')}>Delete entry</button
              >
            </div>
          </details>
        </div>
      {/if}
    </header>
    {#if mode === 'chat'}
      <Metrics amounts={totals} compact {locale} basis="Logged nutrients" />
    {/if}
    <ul class="list-reset">
      {#each entry.items as item (item.id)}
        <li class="stack">
          <div class="item-row">
            <div>
              {#if mode === 'chat' || entry.items.length > 1}
                <button
                  class="item-link"
                  type="button"
                  aria-label={`Replace ${item.label}`}
                  disabled={busy}
                  onclick={() => openReplacement(item)}>{item.label}</button
                >
              {/if}
              <p class="small muted numbers">
                {number.format(item.grams)} g{#if mode === 'chat'}
                  · {item.provenance} · {Math.round(item.confidence * 100)}% confidence
                {/if}
              </p>
            </div>
            <div class="row">
              <button
                class="button"
                type="button"
                aria-label={`Edit portion for ${item.label}`}
                disabled={busy}
                onclick={() => edit(item)}>Edit portion</button
              >
              {#if mode === 'chat'}
                <button
                  class="button quiet danger"
                  type="button"
                  aria-label={`Remove ${item.label}`}
                  disabled={busy}
                  onclick={() => mutate(`/api/entries/${entry.id}/items/${item.id}`, 'DELETE')}
                  >Remove</button
                >
              {/if}
            </div>
          </div>
          {#if editing === item.id}
            <form
              class="row edit-row"
              onsubmit={(event) => {
                event.preventDefault();
                void saveItem(item);
              }}
            >
              <label
                >{item.kind === 'recipe' ? 'Servings' : 'Grams'}
                <input type="number" bind:value={amount} min="0.01" step="any" required /></label
              >
              <button class="button primary" type="submit" disabled={busy}>Save portion</button>
              <button class="button" type="button" onclick={() => (editing = null)}>Cancel</button>
            </form>
          {/if}
          {#if mode === 'today'}
            <details class="item-details">
              <summary class="small muted">Item details</summary>
              <div class="stack">
                <p class="small muted">Source: {item.provenance}</p>
                {#if item.assumptions.length}
                  <ul class="small muted assumptions">
                    {#each item.assumptions as assumption, index (`${index}-${assumption}`)}
                      <li>{assumption}</li>
                    {/each}
                  </ul>
                {/if}
                <Metrics amounts={item.nutrients} compact {locale} basis="Logged amount" />
                <button
                  class="button quiet danger"
                  type="button"
                  aria-label={`Remove ${item.label}`}
                  disabled={busy}
                  onclick={() => mutate(`/api/entries/${entry.id}/items/${item.id}`, 'DELETE')}
                  >Remove item</button
                >
              </div>
            </details>
          {:else if item.assumptions.length}
            <ul class="small muted assumptions">
              {#each item.assumptions as assumption, index (`${index}-${assumption}`)}<li>
                  {assumption}
                </li>{/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
    {#if mode === 'chat' && entry.items.length}
      <div class="row">
        <button class="button quiet" type="button" disabled={busy} onclick={logAgain}
          >Log again</button
        >
        {#if canSaveRecipe}<button
            class="button quiet"
            type="button"
            onclick={() => (saveRecipe = !saveRecipe)}>Save as recipe</button
          >{/if}
      </div>
    {/if}
    {#if saveRecipe}
      <form
        class="row edit-row"
        onsubmit={(event) => {
          event.preventDefault();
          void makeRecipe();
        }}
      >
        <label>Recipe name <input required bind:value={recipeName} /></label>
        <button class="button primary" type="submit" disabled={busy}>Save recipe</button>
      </form>
    {/if}
  {:else}
    <p class="small muted" role="status">
      {entry.status === 'undone' ? 'Log undone' : 'Entry deleted'}
    </p>
  {/if}
  <ErrorNotice message={problem} />
  {#if notice}<p class="success small" role="status">{notice}</p>{/if}
</article>

{#if mode === 'today' && canSplit}
  <SplitMeal {entry} {onchange} bind:this={splitEditor} />
{/if}

<ReplaceItem bind:this={replacementEditor} onreplace={replaceItem} />

<style>
  .log-card {
    padding: 15px;
    border: 1px solid var(--line);
    border-inline-start: 2px solid var(--accent);
    border-radius: var(--radius);
    background: var(--surface-raised);
  }
  header,
  .item-row {
    display: flex;
    justify-content: space-between;
    align-items: start;
    flex-wrap: wrap;
    gap: 10px;
  }
  .heading {
    overflow-wrap: anywhere;
  }
  ul.list-reset > li {
    border-top: 1px solid var(--line);
    padding-top: 10px;
    margin-top: 10px;
  }
  ul.assumptions {
    padding-inline-start: 16px;
    margin-block: 0;
  }
  .edit-row {
    align-items: end;
  }
  .edit-row input {
    width: 125px;
  }
  .diary-entry {
    padding: 8px 0 10px;
    gap: 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .diary-entry header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }
  .diary-entry ul.list-reset > li {
    padding: 0;
    margin: 0;
    gap: 0;
    border: 0;
  }
  .diary-entry ul.list-reset > li + li {
    margin-top: 8px;
  }
  .diary-entry .item-row {
    align-items: center;
    gap: 4px 8px;
  }
  .diary-entry .item-row > div:first-child {
    min-width: 0;
    flex: 1 1 100px;
  }
  .diary-entry .item-link,
  .entry-title {
    min-height: var(--touch-target);
  }
  .entry-title {
    text-align: start;
    text-decoration: underline;
    text-decoration-color: var(--line);
    text-underline-offset: 3px;
  }
  .entry-title:hover {
    color: var(--accent);
    text-decoration-color: currentColor;
  }
  .entry-tools {
    justify-content: end;
    gap: 0;
    max-width: 160px;
  }
  .entry-energy {
    font-size: 0.85rem;
    font-weight: 650;
    text-align: end;
  }
  .entry-energy small {
    display: block;
    font-size: 0.72rem;
    font-weight: 500;
  }
  .entry-actions {
    position: relative;
  }
  .entry-actions > summary {
    width: var(--touch-target);
    padding: 0;
    list-style: none;
    font-size: 1.2rem;
  }
  .entry-actions > summary::-webkit-details-marker {
    display: none;
  }
  .action-panel {
    position: absolute;
    z-index: 2;
    inset-inline-end: 0;
    top: 100%;
    width: 174px;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--control-radius);
    box-shadow: 0 8px 24px var(--shadow);
  }
  .action-panel input {
    width: 100%;
  }
  .item-details {
    justify-self: start;
    max-width: 100%;
  }
  .item-details > summary {
    min-height: var(--touch-target);
    align-content: center;
  }
  .item-details[open] {
    justify-self: stretch;
  }
  .item-details .button {
    justify-self: start;
  }
  .diary-entry .edit-row {
    padding-block: 4px;
  }
</style>
