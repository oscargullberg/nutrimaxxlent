<script lang="ts">
  import { intakeFraction, isIntakeLimit } from '../client/today-nutrition';
  import type { IntakeReference } from '../server/nutrition/references/types';

  let { amount, reference }: { amount: number | null; reference?: IntakeReference } = $props();
  let fraction = $derived(amount !== null && reference ? intakeFraction(amount, reference) : null);
  let over = $derived(
    fraction !== null &&
      reference &&
      isIntakeLimit(reference) &&
      (reference.kind === 'below' ? fraction >= 1 : fraction > 1)
  );
</script>

<span class="track" class:unavailable={fraction === null} aria-hidden="true">
  {#if fraction !== null}
    {#if reference?.kind === 'range'}
      <span class="band" style:left={(reference.min / reference.max) * 100 + '%'}></span>
    {/if}
    <span class="fill" class:over style:width={Math.min(fraction, 1) * 100 + '%'}></span>
  {/if}
</span>

<style>
  .track {
    position: relative;
    display: block;
    height: 4px;
    border-radius: var(--control-radius);
    background: var(--nutrient-track);
  }
  .track.unavailable {
    background: repeating-linear-gradient(
      to right,
      var(--nutrient-track) 0 5px,
      transparent 5px 8px
    );
  }
  .fill {
    position: relative;
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--intake-fill, var(--accent));
  }
  .fill.over {
    background: var(--danger);
  }
  .band {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    border-radius: 0 var(--control-radius) var(--control-radius) 0;
    border-inline-start: 2px solid var(--intake-fill, var(--accent));
    background: color-mix(in srgb, var(--intake-fill, var(--accent)) 17%, var(--nutrient-track));
  }
</style>
