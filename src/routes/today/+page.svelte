<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { api, problemMessage } from '#lib/client/api.ts';
  import { dietaryGroupValue, novaValue, nutrientFormatter } from '#lib/client/nutrition.ts';
  import type { Day, Entry, Settings } from '#lib/client/types.ts';
  import DailySummary from '#lib/components/DailySummary.svelte';
  import ErrorNotice from '#lib/components/ErrorNotice.svelte';
  import FoodPicker, { type Choice } from '#lib/components/FoodPicker.svelte';
  import LogCard from '#lib/components/LogCard.svelte';
  import MealChat from '#lib/components/MealChat.svelte';
  import Modal from '#lib/components/Modal.svelte';
  import NutrientPanel from '#lib/components/NutrientPanel.svelte';
  import { foodGroupIds, foodGroups } from '#lib/food-groups.ts';
  import { mealLabels, mealTypes, type MealType } from '#lib/meal-types.ts';

  let date = $state('');
  let currentDate = $state('');
  let timezone = $state('Europe/Stockholm');
  let locale = $state('en');
  let gramNumber = $derived(nutrientFormatter(locale));
  let gramLowerBound = $derived(nutrientFormatter(locale, true));
  let loaded = $state<{ day: Day; entries: Entry[] } | null>(null);
  let day = $derived(loaded?.day.date === date ? loaded.day : null);
  let entries = $derived(loaded?.day.date === date ? loaded.entries : []);
  let groupsKnown = $derived(day?.dietary.groupsKnown === true);
  let groupsPartial = $derived(
    day ? foodGroupIds.some((id) => day.dietary.groups[id]?.partial === true) : false
  );
  let problem = $state('');
  let loading = $state(true);
  let request = 0;
  let modal: ReturnType<typeof Modal>;
  let nutrientPanel = $state<ReturnType<typeof NutrientPanel>>();
  let foodPicker: ReturnType<typeof FoodPicker>;
  let chosen = $state<Choice | null>(null);
  let amount = $state<number | undefined>(100);
  let meal = $state<MealType>('lunch');
  let addProblem = $state('');
  let adding = $state(false);
  let saved = $state('');
  let logOpen = $state(false);
  let logMounted = $state(false);
  let logHeading = $state<HTMLHeadingElement>();
  let displayDate = $derived(
    date
      ? new Intl.DateTimeFormat(locale, {
          timeZone: 'UTC',
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          ...(date.slice(0, 4) !== currentDate.slice(0, 4) ? { year: 'numeric' } : {})
        }).format(new Date(date + 'T12:00:00Z'))
      : ''
  );

  function validDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  async function loadDate(value = date, background = false) {
    if (!validDate(value)) return;
    const sequence = ++request;
    const changingDay = value !== date;
    if (changingDay) {
      loaded = null;
      logMounted = logOpen;
    }
    if (!background || changingDay) loading = true;
    problem = '';
    date = value;
    saved = '';
    try {
      const [totals, logged] = await Promise.all([
        api<Day>(`/api/totals/day?date=${value}`),
        api<{ entries: Entry[] }>(`/api/entries?date=${value}`)
      ]);
      if (sequence !== request) return;
      loaded = { day: totals, entries: logged.entries };
    } catch (error) {
      if (sequence === request) problem = problemMessage(error);
    } finally {
      if (sequence === request) loading = false;
    }
  }

  async function start() {
    try {
      const settings = await api<Settings>('/api/settings');
      currentDate = settings.today;
      timezone = settings.profile.timezone;
      locale = settings.profile.locale;
      await syncUrl();
    } catch (error) {
      loading = false;
      problem = problemMessage(error);
    }
  }
  onMount(() => void start());
  afterNavigate(({ from, to }) => {
    if (currentDate && from?.route.id === to?.route.id) void syncUrl();
  });

  function syncUrl() {
    logOpen = page.url.searchParams.get('log') === '1';
    if (logOpen) logMounted = true;
    const selected = page.url.searchParams.get('date');
    const nextDate = selected && validDate(selected) ? selected : currentDate;
    if (nextDate !== date) return loadDate(nextDate);
  }

  function browseDate(value: string) {
    if (!validDate(value)) return;
    const url = new URL(page.url.href);
    if (value === currentDate) url.searchParams.delete('date');
    else url.searchParams.set('date', value);
    replaceState(url, page.state);
    void loadDate(value);
  }

  function shift(days: number) {
    if (!date) return;
    const shifted = new Date(date + 'T12:00:00Z');
    shifted.setUTCDate(shifted.getUTCDate() + days);
    browseDate(shifted.toISOString().slice(0, 10));
  }

  async function toggleLog() {
    logOpen = !logOpen;
    const url = new URL(page.url.href);
    if (logOpen) url.searchParams.set('log', '1');
    else url.searchParams.delete('log');
    replaceState(url, page.state);
    if (logOpen) {
      logMounted = true;
      await tick();
      logHeading?.focus();
    }
  }

  function openAdd() {
    chosen = null;
    amount = 100;
    addProblem = '';
    void modal.open();
  }

  async function save() {
    if (!chosen || !amount || !date || adding) return;
    const saveDate = date;
    adding = true;
    addProblem = '';
    try {
      const item =
        chosen.kind === 'food'
          ? { kind: 'food', foodId: chosen.id, quantity: amount, unit: 'g', confidence: 1 }
          : { kind: 'recipe', recipeId: chosen.id, servings: amount, confidence: 1 };
      await api('/api/entries', { method: 'POST', data: { date: saveDate, meal, items: [item] } });
      modal.close();
      if (date === saveDate) {
        await loadDate(saveDate, true);
        if (date === saveDate) saved = 'Entry added.';
      }
    } catch (error) {
      addProblem = problemMessage(error);
    } finally {
      adding = false;
    }
  }
</script>

<svelte:head><title>Today · Nutrimaxxlent</title></svelte:head>
<section class="page stack">
  <div class="page-heading">
    <div class="title">
      <h1>{date && date !== currentDate ? 'Daily log' : 'Today'}</h1>
      {#if displayDate}<p class="muted">{displayDate}</p>{/if}
    </div>
    <div class="dates">
      <div class="date-picker" role="group" aria-label="Browse log by date">
        <button type="button" aria-label="Previous day" onclick={() => shift(-1)} disabled={!date}>
          <span aria-hidden="true">‹</span>
        </button>
        <input
          type="date"
          aria-label="Log date"
          value={date}
          disabled={!date}
          onchange={(event) => {
            const value = event.currentTarget.value;
            if (validDate(value)) browseDate(value);
            else event.currentTarget.value = date;
          }}
        />
        <button type="button" aria-label="Next day" onclick={() => shift(1)} disabled={!date}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      {#if date && currentDate && date !== currentDate}
        <button
          class="button quiet return-today"
          type="button"
          onclick={() => browseDate(currentDate)}>Today</button
        >
      {/if}
    </div>
    <button
      type="button"
      class="button primary log-toggle"
      aria-expanded={logOpen}
      aria-controls="daily-log"
      onclick={toggleLog}
      disabled={!date}
    >
      {#if logOpen}Close log{:else}<span aria-hidden="true">+</span> Log{/if}
    </button>
  </div>
  <section id="daily-log" aria-labelledby="daily-log-heading" hidden={!logOpen}>
    {#if date && logMounted}
      {#key date}
        <MealChat
          {date}
          onchange={(changedDate) => changedDate === date && void loadDate(date, true)}
        >
          <div class="row log-heading">
            <h2 id="daily-log-heading" tabindex="-1" bind:this={logHeading}>Log a meal</h2>
            <div class="row">
              <a class="button quiet" href="/chat-history">Chat history</a>
              <button class="button" type="button" onclick={openAdd}>Add food manually</button>
            </div>
          </div>
        </MealChat>
      {/key}
    {/if}
  </section>
  <ErrorNotice message={problem} retry={() => (date ? void loadDate() : void start())} />
  {#if saved}<p role="status" class="success">{saved}</p>{/if}
  {#if loading}
    <p role="status" class="panel muted">Loading day…</p>
  {:else if day}
    {@const displayedDate = day.date}
    <DailySummary {day} {locale} onselect={(id) => void nutrientPanel?.open(id)} />
    {#if entries.length}
      <a class="text-link small meal-jump" href="#meals-heading">Jump to meals</a>
    {/if}
    <div class="diary" class:with-nutrients={day.coverage.items > 0}>
      <NutrientPanel {day} {entries} {locale} bind:this={nutrientPanel} />
      <div class="stack log">
        <section class="panel meals" aria-labelledby="meals-heading">
          <h2 id="meals-heading" tabindex="-1">Meals</h2>
          {#if entries.length === 0}
            <div class="empty">
              <h3>No entries for this day</h3>
              <p>Use Log to add your first meal.</p>
            </div>
          {/if}
          {#each mealTypes as group (group)}
            {@const groupEntries = entries.filter(({ meal }) => meal === group)}
            {#if groupEntries.length}
              <section class="meal-group">
                <h3>{mealLabels[group]}</h3>
                {#each groupEntries as entry (entry.id)}
                  <LogCard
                    {entry}
                    mode="today"
                    {timezone}
                    {locale}
                    onchange={() => {
                      if (date === displayedDate && day?.date === displayedDate) {
                        void loadDate(displayedDate, true);
                      }
                    }}
                  />
                {/each}
              </section>
            {/if}
          {/each}
        </section>
        {#if day.coverage.items > 0}
          <section class="panel" aria-label="Food groups">
            <details>
              <summary>Food groups</summary>
              <dl class="numbers">
                {#each foodGroupIds as id (id)}
                  {@const amount = day.dietary.groups[id]}
                  <div class="nutrient-row">
                    <dt>{foodGroups[id]}</dt>
                    <dd>{dietaryGroupValue(amount, groupsKnown, gramNumber, gramLowerBound)}</dd>
                  </div>
                {/each}
                <div class="nutrient-row">
                  <dt>Ultra-processed food (NOVA 4)</dt>
                  <dd>
                    {novaValue(
                      day.dietary.novaGrams[4] ?? 0,
                      day.dietary.unknownNovaG,
                      gramNumber,
                      gramLowerBound
                    )}
                  </dd>
                </div>
              </dl>
              {#if !groupsKnown || groupsPartial}
                <p class="muted small">Some logged items are not fully classified.</p>
              {/if}
              {#if day.dietary.unknownNovaG > 0}
                <p class="muted small">
                  NOVA not classified for {gramNumber.format(day.dietary.unknownNovaG)} g of food or ingredients.
                </p>
              {/if}
            </details>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</section>

<Modal title="Add food" bind:this={modal}>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <FoodPicker
      bind:this={foodPicker}
      onselect={(choice) => {
        if (chosen?.kind !== choice.kind) amount = choice.kind === 'food' ? 100 : 1;
        chosen = choice;
      }}
    />
    {#if chosen}
      <button
        class="item-link selected-food"
        type="button"
        aria-label={`Replace ${chosen.name}`}
        disabled={adding}
        onclick={() => foodPicker.focus()}>{chosen.name}</button
      >
      <div class="row">
        <label
          >{chosen.kind === 'food' ? 'Grams' : 'Servings'}
          <input type="number" min="0.01" step="any" required bind:value={amount} /></label
        >
        <label
          >Meal <select bind:value={meal}>
            {#each mealTypes as value (value)}<option {value}>{mealLabels[value]}</option>{/each}
          </select></label
        >
      </div>
    {/if}
    <ErrorNotice message={addProblem} retry={() => void save()} />
    <button type="submit" class="button primary" disabled={!chosen || adding}>Log entry</button>
  </form>
</Modal>

<style>
  .page {
    gap: 18px;
  }
  .diary.with-nutrients {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: start;
    gap: 16px;
  }
  .log {
    gap: 16px;
  }
  .meals {
    display: grid;
    gap: 12px;
  }
  .meal-group > h3 {
    padding: 7px 10px;
    border-radius: var(--control-radius);
    background: var(--surface-raised);
    color: var(--muted);
    font-size: 0.83rem;
  }
  .meal-group :global(.diary-entry + .diary-entry) {
    border-top: 1px solid var(--line);
  }
  .text-link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .meal-jump {
    display: none;
  }
  summary {
    align-content: center;
    min-height: var(--touch-target);
    font-weight: 640;
  }
  .nutrient-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-block: 0.35rem;
  }
  .nutrient-row dd {
    text-align: right;
  }
  .page-heading {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 14px;
    margin-bottom: 0;
  }
  .title p {
    margin-top: 7px;
    font-size: 0.89rem;
  }
  .dates {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .date-picker {
    display: flex;
    align-items: center;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--control-radius);
    background: var(--surface);
  }
  .date-picker button {
    min-width: 38px;
    min-height: var(--touch-target);
    border-radius: var(--control-radius);
    color: var(--accent);
    font-size: 1.35rem;
    line-height: 1;
  }
  .date-picker button:hover:not(:disabled) {
    background: var(--accent-soft);
  }
  .date-picker input {
    width: 128px;
    padding-inline: 5px;
    border: 0;
    background: transparent;
    font-size: 0.83rem;
  }
  .log-toggle span {
    font-size: 1.15rem;
    font-weight: 550;
    line-height: 1;
  }
  .return-today {
    font-size: 0.85rem;
  }
  .log-heading {
    justify-content: space-between;
  }
  .selected-food {
    justify-self: start;
  }
  @media (max-width: 780px) {
    .diary.with-nutrients {
      grid-template-columns: 1fr;
    }
    .meal-jump {
      display: grid;
      align-content: center;
      justify-self: end;
      min-height: var(--touch-target);
      margin-block: -8px;
    }
    .page-heading {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
    }
    .dates {
      grid-row: 2;
      grid-column: 1 / -1;
    }
    .log-toggle {
      grid-column: 2;
      grid-row: 1;
    }
  }
</style>
