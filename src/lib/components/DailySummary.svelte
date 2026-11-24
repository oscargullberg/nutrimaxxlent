<script lang="ts">
  import {
    coreNutrients,
    intakeReferenceValue,
    loggedNutrient,
    nutrientFormatter
  } from '../client/nutrition';
  import { dailyNutrient, intakeFraction, intakePercent } from '../client/today-nutrition';
  import type { Day } from '../client/types';
  import type { NutrientId } from '../nutrition-reference';
  import IntakeMeter from './IntakeMeter.svelte';

  let {
    day,
    locale,
    onselect
  }: {
    day: Day;
    locale: string;
    onselect: (id: NutrientId) => void;
  } = $props();

  const [, ...macros] = coreNutrients;
  let format = $derived(nutrientFormatter(locale));
  let empty = $derived(day.coverage.items === 0);
  let energy = $derived(dailyNutrient(day, 'energy_kcal'));
  let calories = $derived(empty ? 0 : energy.amount);
  let goal = $derived(energy.reference?.kind === 'personal' ? energy.reference.amount : null);
  let energyBasis = $derived(goal === null ? 'estimate' : 'goal');
  let progress = $derived(
    calories !== null && energy.reference ? intakeFraction(calories, energy.reference) : null
  );
  let remaining = $derived(
    goal !== null && calories !== null && !energy.partial ? Math.round(goal - calories) : null
  );
</script>

<section class="panel summary numbers" aria-labelledby="daily-summary-heading">
  <h2 id="daily-summary-heading">Daily intake</h2>
  <div class="overview">
    <button
      class="energy"
      type="button"
      aria-haspopup="dialog"
      onclick={() => onselect('energy_kcal')}
    >
      <span class="energy-copy">
        <span class="energy-label">Calories</span>
        <strong data-testid="energy_kcal">{loggedNutrient(calories, 'kcal', format)}</strong>
        {#if energy.reference}
          <span class="energy-target">
            of {intakeReferenceValue(energy.reference, 'kcal', format)}
            {energyBasis}
          </span>
        {/if}
        {#if energy.partial || energy.estimated}
          <span class="energy-caption">
            {energy.partial ? 'Partial data' : 'Includes estimates'}
          </span>
        {:else if remaining !== null}
          <span class="energy-caption">
            {#if remaining === 0}
              Goal reached
            {:else}
              {format.format(Math.abs(remaining))} kcal {remaining > 0 ? 'left' : 'over goal'}
            {/if}
          </span>
        {/if}
      </span>
      {#if progress !== null}
        <span class="ring" style:--progress={Math.min(progress, 1) * 100 + '%'}>
          <span class="ring-value">{intakePercent(progress, locale)}</span>
          <span class="ring-label">of {energyBasis}</span>
        </span>
      {/if}
    </button>
    <div class="macros">
      {#each macros as { id, label, unit } (id)}
        {@const { amount, partial, estimated, reference } = dailyNutrient(day, id)}
        {@const consumed = empty ? 0 : amount}
        <button
          type="button"
          class="macro"
          data-nutrient={id}
          aria-haspopup="dialog"
          onclick={() => onselect(id)}
        >
          <span class="macro-label">{label}</span>
          <span class="macro-readout">
            <strong data-testid={id}>{loggedNutrient(consumed, unit, format)}</strong>
            {#if reference}
              <span class="macro-target">
                {reference.kind === 'range' ? 'Range' : 'Target'}
                {intakeReferenceValue(reference, unit, format)}
              </span>
            {/if}
          </span>
          {#if reference && consumed !== null}
            <IntakeMeter amount={consumed} {reference} />
          {/if}
          {#if partial || estimated}
            <span class="macro-note">{partial ? 'Partial data' : 'Includes estimates'}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  .summary {
    display: grid;
    gap: 14px;
    border-top: 2px solid var(--accent);
  }
  .overview {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.45fr);
    align-items: stretch;
    gap: 16px;
  }
  .energy {
    --readout: #202d15;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: clamp(12px, 2vw, 24px);
    padding: clamp(17px, 2.4vw, 26px);
    min-height: 180px;
    border: 1px solid var(--control-line);
    border-radius: var(--control-radius);
    background-color: var(--readout);
    background-image: repeating-linear-gradient(0deg, transparent 0 5px, #bdeb5709 5px 6px);
    color: var(--ink);
    text-align: start;
  }
  .energy:hover {
    --readout: var(--accent-soft);
  }
  .energy-copy {
    display: grid;
  }
  .energy-label {
    color: var(--muted);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.055em;
    font-size: 0.83rem;
    font-weight: 640;
  }
  .energy strong {
    margin-block: 3px 2px;
    font-family: var(--font-mono);
    color: var(--accent);
    font-size: clamp(1.5rem, 3.3vw, 2.5rem);
    font-weight: 720;
    line-height: 1.08;
    letter-spacing: -0.055em;
  }
  .energy-target,
  .energy-caption {
    color: var(--muted);
    font-size: 0.79rem;
  }
  .energy-caption {
    justify-self: start;
    margin-top: 9px;
    color: var(--accent);
    font-weight: 660;
  }
  .ring {
    display: grid;
    flex: 0 0 auto;
    place-content: center;
    position: relative;
    isolation: isolate;
    inline-size: clamp(65px, 9.2vw, 104px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: conic-gradient(var(--accent) var(--progress), var(--control-line) 0);
    text-align: center;
  }
  .ring::before {
    position: absolute;
    z-index: -1;
    inset: 6px;
    border-radius: 50%;
    background: var(--readout);
    content: '';
  }
  .ring-value {
    font-family: var(--font-mono);
    font-size: clamp(0.96rem, 1.7vw, 1.32rem);
    line-height: 1.15;
    font-weight: 720;
    letter-spacing: -0.04em;
  }
  .ring-label {
    color: var(--muted);
    font-size: 0.65rem;
  }
  .macros {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }
  .macro {
    display: grid;
    align-content: start;
    gap: 6px;
    min-width: 0;
    padding: 11px 12px;
    border: 1px solid var(--line);
    border-radius: var(--control-radius);
    background: var(--paper);
    text-align: start;
  }
  .macro:hover {
    background: var(--accent-soft);
    border-color: var(--control-line);
  }
  .macro[data-nutrient='protein_g'] {
    --intake-fill: var(--nutrient-protein);
  }
  .macro[data-nutrient='carbs_g'] {
    --intake-fill: var(--nutrient-carbs);
  }
  .macro[data-nutrient='fat_g'] {
    --intake-fill: var(--nutrient-fat);
  }
  .macro[data-nutrient='fiber_g'] {
    --intake-fill: var(--nutrient-fiber);
  }
  .macro-label {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-size: 0.82rem;
    font-weight: 650;
  }
  .macro-label::before {
    inline-size: 7px;
    aspect-ratio: 1;
    transform: rotate(45deg);
    background: var(--intake-fill);
    content: '';
  }
  .macro-readout {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
  }
  .macro-readout strong {
    font-family: var(--font-mono);
    font-size: 1.15rem;
    font-weight: 710;
    line-height: 1.22;
    letter-spacing: -0.035em;
  }
  .macro-target,
  .macro-note {
    color: var(--muted);
    font-size: 0.74rem;
  }
  @media (max-width: 750px) {
    .overview {
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .ring {
      inline-size: 80px;
    }
  }
</style>
