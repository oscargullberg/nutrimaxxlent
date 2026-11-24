<script lang="ts">
  import { coreNutrients, nutrientFormatter } from '../client/nutrition';

  let {
    amounts,
    compact = false,
    locale,
    basis
  }: {
    amounts: Partial<Record<string, number | null>>;
    compact?: boolean;
    locale?: string;
    basis?: string;
  } = $props();
  let format = $derived(nutrientFormatter(locale));
  let displayed = $derived(coreNutrients.filter(({ id }) => amounts[id] != null));
</script>

{#if displayed.length}
  {#if basis}<p class="small muted">{basis}</p>{/if}
  <dl class:compact class="metric-list numbers">
    {#each displayed as { id, label, unit } (id)}
      <div>
        <dt>{label}</dt>
        <dd>{format.format(amounts[id]!)} <span>{unit}</span></dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
  .compact {
    display: flex;
    flex-wrap: wrap;
    gap: 9px 16px;
  }
  .compact dd {
    font-size: 1rem;
  }
  dd span {
    color: var(--muted);
    font-size: 0.73em;
    font-weight: 530;
  }
</style>
