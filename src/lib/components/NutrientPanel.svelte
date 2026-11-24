<script lang="ts">
  import {
    intakeReferenceLabel,
    intakeReferenceValue,
    loggedNutrient,
    nutrientFormatter,
    nutrientLabel
  } from '../client/nutrition';
  import { dailyNutrient, intakeComparison, isIntakeLimit } from '../client/today-nutrition';
  import type { Day, Entry } from '../client/types';
  import {
    canonicalNutrients,
    trackedNutrientGroups,
    type NutrientId
  } from '../nutrition-reference';
  import IntakeMeter from './IntakeMeter.svelte';
  import Modal from './Modal.svelte';

  let { day, entries, locale }: { day: Day; entries: Entry[]; locale: string } = $props();
  let selected = $state<NutrientId>('energy_kcal');
  let query = $state('');
  let modal: ReturnType<typeof Modal>;
  let about: ReturnType<typeof Modal>;

  let nutrient = $derived(canonicalNutrients.find(({ id }) => id === selected)!);
  let detail = $derived(dailyNutrient(day, selected));
  let published = $derived(day.intake.published[selected]);
  let guidance = $derived(day.intake.source.guidance?.[selected]);
  let estimatedAmount = $derived(day.estimatedTotals[selected]);
  let format = $derived(nutrientFormatter(locale));
  let items = $derived(entries.flatMap((entry) => entry.items));
  let groups = $derived.by(() => {
    const search = query.trim().toLocaleLowerCase(locale);
    return trackedNutrientGroups
      .map(({ title, nutrients }) => ({
        title,
        nutrients: nutrients.filter(({ id, name }) =>
          `${nutrientLabel(id, name)} ${name}`.toLocaleLowerCase(locale).includes(search)
        )
      }))
      .filter((group) => group.nutrients.length);
  });
  let contributors = $derived.by(() => {
    const totals = new Map<string, { label: string; amount: number; estimated: boolean }>();
    for (const item of items) {
      const amount = item.nutrients[selected];
      if (amount == null || amount <= 0) continue;
      const key = item.foodId ?? item.recipeId ?? item.label;
      const total = totals.get(key);
      const estimated = item.estimatedNutrients.includes(selected);
      if (total) {
        total.amount += amount;
        total.estimated ||= estimated;
      } else totals.set(key, { label: item.label, amount, estimated });
    }
    return [...totals.entries()].toSorted(([, a], [, b]) => b.amount - a.amount).slice(0, 3);
  });

  export async function open(id: NutrientId) {
    selected = id;
    await modal.open();
  }
</script>

{#snippet nutrientRow(item: (typeof canonicalNutrients)[number])}
  {@const { id, name, unit } = item}
  {@const { amount, known, partial, estimated, reference } = dailyNutrient(day, id)}
  {@const limit = reference && isIntakeLimit(reference) ? reference.amount : null}
  {@const atLimit = amount !== null && limit !== null && amount >= limit}
  <li>
    <button
      class="nutrient-row numbers"
      type="button"
      aria-haspopup="dialog"
      onclick={() => open(id)}
    >
      <span class="row-name">
        <strong>{nutrientLabel(id, name)}</strong>
        {#if partial || estimated}
          <span class="status">
            {#if partial}{known} of {day.coverage.items} items{/if}
            {#if estimated}{partial ? ' · ' : ''}Includes estimates{/if}
          </span>
        {/if}
      </span>
      <span class="row-value">
        <strong class:missing={amount === null}>{loggedNutrient(amount, unit, format)}</strong>
        {#if reference}
          <span class="status">
            {reference.kind === 'range'
              ? 'Range'
              : limit !== null
                ? 'Limit'
                : reference.kind === 'estimate'
                  ? 'Estimate'
                  : reference.kind === 'personal'
                    ? 'Goal'
                    : 'Target'}
            {intakeReferenceValue(reference, unit, format)}
          </span>
        {/if}
      </span>
      <span class="chevron" aria-hidden="true">›</span>
      <span class="comparison">
        <IntakeMeter {amount} {reference} />
        {#if amount !== null && reference}
          <span class:at-limit={atLimit}>
            {intakeComparison(amount, reference, locale, partial)}
          </span>
        {:else if !reference}
          <span>No numeric target</span>
        {/if}
      </span>
    </button>
  </li>
{/snippet}

{#if day.coverage.items > 0}
  <section class="panel nutrients" aria-labelledby="all-nutrients">
    <div class="section-header">
      <h2 id="all-nutrients">All nutrients</h2>
      <button
        type="button"
        class="text-action small"
        aria-haspopup="dialog"
        onclick={() => about.open()}
      >
        Targets &amp; data
      </button>
    </div>
    <label class="search">
      Find a nutrient
      <input type="search" placeholder="e.g. trans fat" bind:value={query} />
    </label>
    {#each groups as group (group.title)}
      <div class="nutrient-group">
        <h3>{group.title}</h3>
        <ul class="list-reset complete-list">
          {#each group.nutrients as item (item.id)}
            {@render nutrientRow(item)}
          {/each}
        </ul>
      </div>
    {:else}
      <p class="muted small">No matching nutrients.</p>
    {/each}
  </section>
{/if}

<Modal title={nutrientLabel(nutrient.id, nutrient.name)} bind:this={modal}>
  <div class="stack numbers nutrient-detail">
    <div>
      <p class="nutrient-value">
        {day.coverage.items === 0
          ? 'Nothing logged'
          : loggedNutrient(detail.amount, nutrient.unit, format)}
      </p>
      {#if day.coverage.items === 0}
        <p class="muted small">Log food to see how much you’ve had.</p>
      {:else if detail.known === 0}
        <p class="muted small">
          None of the logged items has a value for this nutrient. Its amount is unknown.
        </p>
      {:else}
        <p class="muted small">
          Data for {detail.known} of {day.coverage.items} logged {day.coverage.items === 1
            ? 'item'
            : 'items'}.
          {#if detail.partial}The amount shown comes from the items with data.{/if}
        </p>
      {/if}
      {#if estimatedAmount !== undefined}
        <p class="muted small">
          Includes an estimated {format.format(estimatedAmount)}
          {nutrient.unit}.
        </p>
      {/if}
    </div>
    <div class="reference">
      {#if detail.reference}
        <span class="reference-basis">{intakeReferenceLabel(detail.reference)}</span>
        <strong>{intakeReferenceValue(detail.reference, nutrient.unit, format)}</strong>
        {#if detail.amount !== null}
          <p class="small">
            {intakeComparison(detail.amount, detail.reference, locale, detail.partial)}
          </p>
          <IntakeMeter amount={detail.amount} reference={detail.reference} />
        {/if}
        {#if detail.reference.kind === 'personal' && published}
          <p class="muted small">
            {intakeReferenceLabel(published)} in the reference guidance
            <strong>{intakeReferenceValue(published, nutrient.unit, format)}</strong>
          </p>
        {/if}
      {:else if guidance}
        <span class="reference-basis">Daily guidance</span>
        <strong>{guidance}</strong>
      {:else}
        <p class="muted small">No numeric daily target is configured for this nutrient.</p>
      {/if}
    </div>
    {#if contributors.length}
      <div>
        <h3>
          {items.length === day.coverage.items
            ? 'Top contributors'
            : 'Top contributors in displayed meals'}
        </h3>
        <ul class="list-reset">
          {#each contributors as [key, contributor] (key)}
            <li class="contributor">
              <span>{contributor.label}</span>
              <span class="contributor-amount">
                <strong>{format.format(contributor.amount)} {nutrient.unit}</strong>
                {#if contributor.estimated}
                  <small class="muted">estimated</small>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <p class="reference-source small muted">
      <a href={day.intake.source.url}>{day.intake.source.name}</a>
      · {day.intake.source.population}
    </p>
  </div>
</Modal>

<Modal title="Targets & data" bind:this={about}>
  <div class="stack notes">
    <p>
      <strong>0 means a zero was recorded.</strong> “No data” means none of the logged items has a value
      for that nutrient. A zero with partial data only describes the items that have values.
    </p>
    <p>
      <strong>Partial data and estimates are labelled.</strong> Daily comparisons use the values available
      in your log.
    </p>
    <p>
      <strong>Dashed bars</strong> indicate missing data or a missing numeric target.
    </p>
    <p>
      <strong>Daily targets</strong> use the reference below and any personal goals you set. A limit is
      an upper threshold. A range shows the recommended span.
    </p>
    <p class="reference-source muted small">
      <a href={day.intake.source.url}>{day.intake.source.name}</a>
      · {day.intake.source.population} · {day.intake.source.revision}
    </p>
  </div>
</Modal>

<style>
  .nutrients {
    display: grid;
    gap: 13px;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px 14px;
    flex-wrap: wrap;
  }
  .text-action {
    min-height: var(--touch-target);
    color: var(--accent);
    font-weight: 640;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .nutrient-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto) 11px;
    align-items: start;
    gap: 2px 9px;
    width: 100%;
    min-height: var(--touch-target);
    padding: 9px 2px;
    text-align: start;
  }
  .nutrient-row:hover {
    color: var(--accent);
  }
  .row-name,
  .row-value {
    display: grid;
    gap: 1px;
    overflow-wrap: anywhere;
  }
  .row-name strong {
    font-size: 0.91rem;
    font-weight: 670;
  }
  .row-value {
    text-align: end;
  }
  .row-value strong {
    font-size: 0.95rem;
    font-weight: 710;
  }
  .row-value strong.missing {
    color: var(--muted);
    font-weight: 500;
  }
  .status,
  .comparison {
    color: var(--muted);
    font-size: 0.74rem;
  }
  .chevron {
    align-self: start;
    justify-self: end;
    color: var(--accent);
    font-size: 1.08rem;
    line-height: 1.25;
  }
  .comparison {
    grid-column: 1 / 3;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 46%);
    align-items: center;
    gap: 8px;
    min-height: 1.15rem;
    margin-top: 2px;
    text-align: end;
  }
  .comparison .at-limit {
    color: var(--danger);
    font-weight: 650;
  }
  .search {
    color: var(--muted);
    font-size: 0.81rem;
  }
  .nutrient-group h3 {
    margin-block: 3px 6px;
    font-size: 0.86rem;
  }
  .complete-list li {
    border-top: 1px solid var(--line);
  }
  .nutrient-value {
    font-size: 1.85rem;
    font-weight: 710;
    letter-spacing: -0.045em;
  }
  .reference {
    display: grid;
    gap: 5px;
    padding: 13px 15px;
    border: 1px solid var(--line);
    border-radius: var(--control-radius);
    background: var(--paper);
  }
  .reference-basis {
    color: var(--muted);
    font-size: 0.81rem;
  }
  .reference-source a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .contributor {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-block: 8px;
    border-bottom: 1px solid var(--line);
  }
  .contributor-amount {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45em;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .contributor span {
    overflow-wrap: anywhere;
  }
  .notes {
    font-size: 0.9rem;
  }
</style>
