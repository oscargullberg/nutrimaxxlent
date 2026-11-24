<script lang="ts">
  import { api, problemMessage } from '../client/api';
  import type { FoodResult, RecipeResult } from '../client/types';
  import ErrorNotice from './ErrorNotice.svelte';

  export type Choice = {
    kind: 'food' | 'recipe';
    id: string;
    name: string;
    nameEn?: string | null;
  };
  let {
    onselect,
    label = 'Search foods and recipes'
  }: { onselect: (choice: Choice) => void; label?: string } = $props();
  let query = $state('');
  let foods = $state<FoodResult[]>([]);
  let recipes = $state<RecipeResult[]>([]);
  let count = $state(0);
  let searched = $state(false);
  let loading = $state(false);
  let problem = $state('');
  let searchInput: HTMLInputElement;

  export function focus() {
    searchInput.focus();
  }

  async function search() {
    const value = query.trim();
    if (!value) return;
    loading = true;
    problem = '';
    try {
      const q = encodeURIComponent(value);
      const [catalog, saved] = await Promise.all([
        api<{ foods: FoodResult[]; count: number }>(`/api/foods?q=${q}&limit=6`),
        api<{ recipes: RecipeResult[] }>(`/api/recipes?q=${q}`)
      ]);
      foods = catalog.foods;
      count = catalog.count;
      recipes = saved.recipes.slice(0, 5);
      searched = true;
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      loading = false;
    }
  }

  function choose(choice: Choice) {
    query = '';
    searched = false;
    foods = [];
    recipes = [];
    onselect(choice);
  }
</script>

<div class="stack">
  <div class="row search-row">
    <label
      >{label}<input
        type="search"
        bind:this={searchInput}
        bind:value={query}
        data-initial-focus
        placeholder="Food or recipe name"
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void search();
          }
        }}
      /></label
    >
    <button class="button" type="button" disabled={!query.trim() || loading} onclick={search}
      >Search</button
    >
  </div>
  <ErrorNotice message={problem} retry={() => void search()} />
  {#if searched}
    <div class="stack results" aria-label="Search results">
      {#each foods as food (food.id)}
        <button
          type="button"
          class="button pick"
          onclick={() =>
            choose({ kind: 'food', id: food.id, name: food.name, nameEn: food.nameEn })}
        >
          {food.name}<small class="muted">{food.sourceName}</small>
        </button>
      {/each}
      {#each recipes as recipe (recipe.id)}
        <button
          type="button"
          class="button pick"
          onclick={() => choose({ kind: 'recipe', id: recipe.id, name: recipe.name })}
        >
          {recipe.name}<small class="muted">Recipe</small>
        </button>
      {/each}
      {#if !foods.length && !recipes.length}
        <p class="muted small">
          {count
            ? 'No matching food or recipe.'
            : 'The food catalog is empty. Run pnpm data:refresh slv or add a custom food.'}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search-row {
    align-items: end;
  }
  .search-row label {
    flex: 1;
  }
  .results {
    max-height: 235px;
    overflow: auto;
    gap: 6px;
  }
  .pick {
    justify-content: space-between;
    text-align: start;
  }
</style>
