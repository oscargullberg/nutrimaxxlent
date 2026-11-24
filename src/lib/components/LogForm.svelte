<script lang="ts">
  import { api, problemMessage } from '../client/api';
  import { mealLabels, mealTypes, type MealType } from '../meal-types';
  import ErrorNotice from './ErrorNotice.svelte';
  let {
    id,
    kind,
    defaultPortion = false
  }: { id: string; kind: 'food' | 'recipe'; defaultPortion?: boolean } = $props();
  let amount = $state<number | undefined>(undefined);
  let unit = $state('g');
  let meal = $state<MealType>('other');
  let problem = $state('');
  let notice = $state('');
  let busy = $state(false);

  $effect(() => {
    if (!id) return;
    amount = kind === 'recipe' || defaultPortion ? 1 : 100;
    unit = defaultPortion ? 'portion' : 'g';
    notice = '';
    problem = '';
  });

  async function save() {
    if (!amount || busy) return;
    busy = true;
    problem = '';
    notice = '';
    const item =
      kind === 'food'
        ? { kind, foodId: id, quantity: amount, unit, confidence: 1 }
        : { kind, recipeId: id, servings: amount, confidence: 1 };
    try {
      await api('/api/entries', { method: 'POST', data: { meal, items: [item] } });
      notice = 'Logged in Today.';
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="stack"
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <div class="row fields">
    <label
      >{kind === 'recipe' ? 'Servings' : 'Amount'}
      <input type="number" bind:value={amount} required min="0.01" step="any" />
    </label>
    {#if kind === 'food'}
      <label
        >Unit
        <select bind:value={unit}>
          <option value="g">Grams</option>
          {#if defaultPortion}<option value="portion">Serving</option>{/if}
        </select>
      </label>
    {/if}
    <label
      >Meal
      <select bind:value={meal}>
        {#each mealTypes as value (value)}
          <option {value}>{mealLabels[value]}</option>
        {/each}
      </select>
    </label>
    <button class="button primary" type="submit" disabled={busy}
      >{kind === 'recipe' ? 'Log recipe' : 'Log food'}</button
    >
  </div>
  <ErrorNotice message={problem} retry={() => void save()} />
  {#if notice}<p class="small success" role="status">
      {notice} <a href="/today">View entry</a>
    </p>{/if}
</form>

<style>
  .fields {
    align-items: end;
  }
  input {
    width: 85px;
  }
</style>
