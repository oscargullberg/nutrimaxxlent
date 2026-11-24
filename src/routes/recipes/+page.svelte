<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, problemMessage } from '#lib/client/api.ts';
  import type { Recipe, RecipeResult } from '#lib/client/types.ts';
  import ErrorNotice from '#lib/components/ErrorNotice.svelte';
  import FoodPicker, { type Choice } from '#lib/components/FoodPicker.svelte';
  import LogForm from '#lib/components/LogForm.svelte';
  import Metrics from '#lib/components/Metrics.svelte';

  type IngredientRow = Choice & {
    key: string;
    quantity: number | undefined;
    unit: string;
    optional: boolean;
  };
  let query = $state('');
  let searchResults = $state<RecipeResult[]>([]);
  let recipe = $state<Recipe | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let editing = $state(false);
  let name = $state('');
  let description = $state('');
  let instructions = $state('');
  let servings = $state<number | undefined>(2);
  let totalWeight = $state<number | undefined>();
  let ingredients = $state<IngredientRow[]>([]);
  let problem = $state('');
  let notice = $state('');
  let nextDetail = 0;

  async function list() {
    loading = true;
    problem = '';
    try {
      searchResults = (
        await api<{ recipes: RecipeResult[] }>(`/api/recipes?q=${encodeURIComponent(query.trim())}`)
      ).recipes;
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      loading = false;
    }
  }

  async function open(id: string) {
    const version = ++nextDetail;
    problem = '';
    notice = '';
    try {
      const selected = (await api<{ recipe: Recipe }>(`/api/recipes/${id}`)).recipe;
      if (version !== nextDetail) return;
      recipe = selected;
      editing = false;
    } catch (error) {
      problem = problemMessage(error);
    }
  }

  async function start() {
    await list();
    const id = page.url.searchParams.get('id');
    if (id) await open(id);
  }
  onMount(() => void start());

  function edit(existing: Recipe | null = null) {
    ++nextDetail;
    recipe = existing;
    name = existing?.name ?? '';
    description = existing?.description ?? '';
    instructions = existing?.instructions ?? '';
    servings = existing?.servings ?? 2;
    totalWeight = existing?.totalWeightG ?? undefined;
    ingredients =
      existing?.ingredients.map((item): IngredientRow => ({
        key: item.id,
        id: item.foodId ?? item.subRecipeId ?? '',
        name: item.name,
        kind: item.foodId ? 'food' : 'recipe',
        unit: item.unit,
        quantity: item.quantity,
        optional: item.optional
      })) ?? [];
    problem = '';
    notice = '';
    editing = true;
  }

  function append(choice: Choice) {
    if (recipe?.id === choice.id) {
      problem = 'A recipe cannot include itself.';
      return;
    }
    ingredients = [
      ...ingredients,
      {
        ...choice,
        key: crypto.randomUUID(),
        quantity: choice.kind === 'food' ? 100 : 1,
        unit: choice.kind === 'food' ? 'g' : 'serving',
        optional: false
      }
    ];
  }

  async function save() {
    if (busy || !servings || !ingredients.length) return;
    busy = true;
    problem = '';
    notice = '';
    try {
      const itemRows = ingredients.map(({ id, kind, quantity, unit, optional }) => ({
        kind,
        ...(kind === 'food' ? { foodId: id } : { recipeId: id }),
        quantity,
        unit,
        optional
      }));
      const url = recipe ? `/api/recipes/${recipe.id}` : '/api/recipes';
      recipe = (
        await api<{ recipe: Recipe }>(url, {
          method: recipe ? 'PATCH' : 'POST',
          data: {
            name,
            servings,
            description,
            instructions,
            totalWeightG: totalWeight,
            ingredients: itemRows
          }
        })
      ).recipe;
      editing = false;
      query = '';
      await list();
      notice = 'Recipe saved.';
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!recipe || busy) return;
    busy = true;
    problem = '';
    try {
      await api(`/api/recipes/${recipe.id}`, { method: 'DELETE' });
      recipe = null;
      await list();
      notice = 'Recipe deleted.';
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Recipes · Nutrimaxxlent</title></svelte:head>
<section class="page stack">
  <div class="page-heading">
    <div>
      <h1>Recipes</h1>
      <p class="muted">Save meals you make often and log them by serving.</p>
    </div>
    <button class="button primary" type="button" onclick={() => edit()}>New recipe</button>
  </div>
  <ErrorNotice message={problem} retry={() => (editing ? void save() : void list())} />
  {#if notice}<p class="success" role="status">{notice}</p>{/if}
  <div class="split">
    <aside class="panel stack">
      <form
        class="row search-form"
        onsubmit={(event) => {
          event.preventDefault();
          void list();
        }}
      >
        <label
          >Search recipes <input
            type="search"
            bind:value={query}
            placeholder="Recipe name"
          /></label
        >
        <button class="button" type="submit">Search</button>
      </form>
      {#if loading}<p class="muted" role="status">Loading recipes…</p>
      {:else if searchResults.length}
        <ul class="list-reset">
          {#each searchResults as result (result.id)}
            <li>
              <button
                type="button"
                class="recipe-row"
                class:selected={recipe?.id === result.id}
                onclick={() => open(result.id)}
              >
                <strong>{result.name}</strong><span class="muted small"
                  >{result.servings} servings</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="empty">
          <h2>{query ? 'No matching recipes' : 'No saved recipes'}</h2>
          <p>Use New recipe to create one.</p>
        </div>
      {/if}
    </aside>

    {#if editing}
      <form
        class="panel stack"
        onsubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2>{recipe ? 'Edit recipe' : 'New recipe'}</h2>
        <label>Recipe name <input required maxlength="200" bind:value={name} /></label>
        <div class="row quantities">
          <label
            >Servings <input
              type="number"
              required
              min="0.01"
              step="any"
              bind:value={servings}
            /></label
          >
          <label
            >Cooked weight (g) <input
              type="number"
              min="0.01"
              step="any"
              bind:value={totalWeight}
            /></label
          >
        </div>
        <label
          >Description <textarea rows="2" bind:value={description} maxlength="5000"
          ></textarea></label
        >
        <label
          >Instructions <textarea rows="3" bind:value={instructions} maxlength="10000"
          ></textarea></label
        >
        <div class="stack">
          <h3>Ingredients</h3>
          <FoodPicker label="Find an ingredient" onselect={append} />
          {#each ingredients as ingredient (ingredient.key)}
            <div class="ingredient stack">
              <div class="row ingredient-name">
                <strong>{ingredient.name}</strong><button
                  type="button"
                  class="button quiet danger"
                  aria-label={`Remove ${ingredient.name}`}
                  onclick={() =>
                    (ingredients = ingredients.filter(({ key }) => key !== ingredient.key))}
                  >Remove</button
                >
              </div>
              <div class="row quantities">
                <label
                  >Quantity <input
                    type="number"
                    required
                    min="0.01"
                    step="any"
                    bind:value={ingredient.quantity}
                  /></label
                >
                <label>Unit <input required maxlength="100" bind:value={ingredient.unit} /></label>
                <label class="row"
                  ><input type="checkbox" bind:checked={ingredient.optional} /> Optional</label
                >
              </div>
            </div>
          {/each}
        </div>
        <div class="row">
          <button type="submit" class="button primary" disabled={!ingredients.length || busy}
            >Save recipe</button
          >
          <button type="button" class="button" onclick={() => (editing = false)}>Cancel</button>
        </div>
      </form>
    {:else if recipe}
      <article class="panel stack" aria-label="Recipe details">
        <header class="row recipe-header">
          <div>
            <h2>{recipe.name}</h2>
            <p class="small muted">
              {recipe.servings} servings · {Math.round(recipe.nutrition.gramsPerServing)} g per serving
            </p>
          </div>
          <button class="button" type="button" onclick={() => edit(recipe)}>Edit recipe</button>
        </header>
        {#if recipe.description}<p>{recipe.description}</p>{/if}
        <h3>Per serving</h3>
        <Metrics amounts={recipe.nutrition.perServing} />
        <div>
          <h3>Ingredients</h3>
          <ul class="list-reset">
            {#each recipe.ingredients as item (item.id)}
              <li class="row ingredient-name">
                <span>{item.name}{item.optional ? ' (optional)' : ''}</span><span
                  class="muted numbers">{item.quantity} {item.unit}</span
                >
              </li>
            {/each}
          </ul>
        </div>
        {#if recipe.instructions}<p class="instructions">{recipe.instructions}</p>{/if}
        <LogForm id={recipe.id} kind="recipe" />
        <div>
          <button class="button danger quiet" type="button" disabled={busy} onclick={remove}
            >Delete recipe</button
          >
        </div>
      </article>
    {/if}
  </div>
</section>

<style>
  .page-heading {
    margin-bottom: 0;
  }
  .search-form {
    align-items: end;
  }
  .search-form label {
    flex: 1;
  }
  .recipe-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    border-bottom: 1px solid var(--line);
    padding: 11px 8px;
  }
  .recipe-row:hover,
  .recipe-row.selected {
    background: var(--accent-soft);
    border-radius: var(--control-radius);
  }
  .ingredient {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--control-radius);
    padding: 9px 11px;
    gap: 5px;
  }
  .ingredient-name,
  .recipe-header {
    justify-content: space-between;
  }
  .quantities {
    align-items: end;
  }
  .quantities input:not([type='checkbox']) {
    width: 105px;
  }
  .instructions {
    white-space: pre-wrap;
  }
</style>
