<script lang="ts">
  import { onMount } from 'svelte';
  import { api, problemMessage } from '#lib/client/api.ts';
  import { nutrientFormatter, nutrientLabel } from '#lib/client/nutrition.ts';
  import type { Food, FoodResult, RecipeResult, Source } from '#lib/client/types.ts';
  import {
    agentPortionSource,
    canonicalNutrients,
    portionUnitName,
    productLabelSource,
    trackedNutrientGroups,
    type NutrientId
  } from '#lib/nutrition-reference.ts';
  import ErrorNotice from '#lib/components/ErrorNotice.svelte';
  import LogForm from '#lib/components/LogForm.svelte';
  import Metrics from '#lib/components/Metrics.svelte';
  import Modal from '#lib/components/Modal.svelte';

  let sources = $state<Source[]>([]);
  let source = $state('');
  let query = $state('');
  let matches = $state<FoodResult[]>([]);
  let recipes = $state<RecipeResult[]>([]);
  let total = $state<number | undefined>();
  let active = $state<Food | null>(null);
  let activeSource = $state('');
  const productLabelUrl = $derived(
    active?.sourceId === productLabelSource
      ? active.nutrientRows.find((row) => typeof row.sourceMeta?.sourceUrl === 'string')?.sourceMeta
          ?.sourceUrl
      : undefined
  );
  let portion = $state<number | undefined>();
  let portionUnit = $state('portion');
  const savedUnits = $derived([
    'portion',
    ...new Set(
      active?.portions.flatMap((row) =>
        row.source === agentPortionSource && row.unit !== 'portion' ? [row.unit] : []
      )
    )
  ]);
  let problem = $state('');
  let loading = $state(false);
  let detailLoading = $state(false);
  let searched = $state(false);
  let notice = $state('');
  let modal: ReturnType<typeof Modal>;
  let customName = $state('');
  let customKcal = $state<number | undefined>();
  let customProtein = $state<number | undefined>();
  let customNutrients = $state<Partial<Record<NutrientId, number | undefined>>>({});
  let customProblem = $state('');
  let creating = $state(false);
  const number = nutrientFormatter();
  let searchId = 0;
  let detailId = 0;

  async function start() {
    try {
      sources = (await api<{ sources: Source[] }>('/api/meta/sources')).sources;
      await search();
    } catch (error) {
      problem = problemMessage(error);
    }
  }
  onMount(() => void start());

  async function search() {
    const id = ++searchId;
    const value = query.trim();
    loading = true;
    problem = '';
    try {
      const q = encodeURIComponent(value);
      const filter = source ? `&source=${encodeURIComponent(source)}` : '';
      const [catalog, saved] = await Promise.all([
        api<{ foods: FoodResult[]; count: number }>(`/api/foods?q=${q}${filter}&limit=24`),
        value && !source ? api<{ recipes: RecipeResult[] }>(`/api/recipes?q=${q}`) : { recipes: [] }
      ]);
      if (id !== searchId) return;
      matches = catalog.foods;
      total = catalog.count;
      recipes = saved.recipes;
      searched = Boolean(value);
    } catch (error) {
      if (id === searchId) problem = problemMessage(error);
    } finally {
      if (id === searchId) loading = false;
    }
  }

  async function detail(food: FoodResult) {
    const id = ++detailId;
    detailLoading = true;
    problem = '';
    notice = '';
    try {
      const result = (await api<{ food: Food }>(`/api/foods/${food.id}`)).food;
      if (id !== detailId) return;
      active = result;
      activeSource = food.sourceName;
      portionUnit = 'portion';
      portion = result.portions.find((item) => item.source === 'user' && item.isDefault)?.grams;
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      if (id === detailId) detailLoading = false;
    }
  }

  async function savePreference(data: {
    favorite?: boolean;
    portionG?: number | null;
    portionUnit?: string;
  }) {
    if (!active) return;
    try {
      active = (await api<{ food: Food }>(`/api/foods/${active.id}`, { method: 'PATCH', data }))
        .food;
      notice =
        data.favorite === undefined
          ? 'Serving saved.'
          : active.favorite
            ? 'Added to favorites.'
            : 'Removed from favorites.';
    } catch (error) {
      problem = problemMessage(error);
    }
  }

  async function createFood() {
    if (customKcal === undefined || creating) return;
    creating = true;
    customProblem = '';
    try {
      const per100g = {
        ...customNutrients,
        energy_kcal: customKcal,
        ...(customProtein === undefined ? {} : { protein_g: customProtein })
      };
      active = (
        await api<{ food: Food }>('/api/foods', {
          method: 'POST',
          data: { name: customName, per100g }
        })
      ).food;
      activeSource = 'My foods';
      portionUnit = 'portion';
      portion = undefined;
      notice = 'Food saved.';
      query = customName;
      source = '';
      modal.close();
      await search();
    } catch (error) {
      customProblem = problemMessage(error);
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head><title>Foods · Nutrimaxxlent</title></svelte:head>
<section class="page stack">
  <div class="page-heading">
    <div>
      <h1>Foods</h1>
      <p class="muted">Search by name, brand, or barcode.</p>
    </div>
    <button
      class="button"
      type="button"
      onclick={() => {
        customName = '';
        customKcal = undefined;
        customProtein = undefined;
        customNutrients = {};
        customProblem = '';
        void modal.open();
      }}>Add custom food</button
    >
  </div>
  <div class="split">
    <section class="panel stack">
      <form
        class="row search"
        onsubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label
          >Search foods<input
            type="search"
            placeholder="Search by name, brand, or barcode"
            bind:value={query}
          /></label
        >
        <label
          >Source<select bind:value={source} onchange={search}>
            <option value="">All sources</option>
            {#each sources as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
            <option value="user">My foods</option>
          </select></label
        >
        <button class="button primary" type="submit" disabled={loading}>Search</button>
      </form>
      <ErrorNotice message={problem} retry={() => void start()} />
      {#if loading}<p role="status" class="muted">Searching foods…</p>
      {:else}
        {#if matches.length || recipes.length}
          <ul class="list-reset results">
            {#each matches as food (food.id)}
              <li>
                <button
                  type="button"
                  class="result"
                  class:selected={active?.id === food.id}
                  onclick={() => detail(food)}
                >
                  <span
                    ><strong>{food.name}</strong><small
                      >{food.brand ? food.brand + ' · ' : ''}{food.sourceName}</small
                    ></span
                  >
                  {#if food.energyKcal !== null}<span class="numbers small"
                      >{number.format(food.energyKcal)} kcal / 100 g</span
                    >{/if}
                </button>
              </li>
            {/each}
            {#each recipes as recipe (recipe.id)}
              <li>
                <a class="result" href={`/recipes?id=${recipe.id}`}
                  ><span><strong>{recipe.name}</strong><small>Recipe</small></span></a
                >
              </li>
            {/each}
          </ul>
        {:else if total === 0}
          <div class="empty">
            <h2>The food catalog is empty</h2>
            <p>
              In the project folder, run <code class="code">pnpm data:refresh slv</code> or add a custom
              food.
            </p>
          </div>
        {:else if searched}<p class="muted">No foods match this search.</p>
        {:else}<p class="small muted">
            Enter a food or product name to see matching catalog entries.
          </p>
        {/if}
      {/if}
    </section>

    {#if detailLoading}<p class="panel muted" role="status">Loading food…</p>
    {:else if active}
      <aside class="panel stack" aria-label="Food details">
        <header class="row">
          <div>
            <h2>{active.name}</h2>
            <p class="small muted">{activeSource}{active.brand ? ' · ' + active.brand : ''}</p>
          </div>
          <button
            class="button"
            type="button"
            onclick={() => savePreference({ favorite: !active?.favorite })}
            >{active.favorite ? 'Unfavorite' : 'Favorite'}</button
          >
        </header>
        {#if active.barcode}<p class="small muted numbers">Barcode {active.barcode}</p>{/if}
        {#if typeof productLabelUrl === 'string'}
          <a href={productLabelUrl} target="_blank" rel="noreferrer">Product label</a>
        {/if}
        <h3>Per 100 g</h3>
        <Metrics amounts={active.nutrients} />
        <details>
          <summary>All nutrients</summary>
          <dl class="nutrient-table">
            {#each canonicalNutrients as nutrient (nutrient.id)}
              {@const value = active.nutrients[nutrient.id]}
              <div>
                <dt>{nutrientLabel(nutrient.id, nutrient.name)} ({nutrient.unit})</dt>
                <dd>{value == null ? 'No data' : number.format(value)}</dd>
              </div>
            {/each}
          </dl>
        </details>
        {#if active.components.length}
          <div class="stack">
            <h3>Components</h3>
            <ul class="list-reset">
              {#each active.components as item (item.id)}
                <li
                  class="component"
                  style:padding-inline-start={`${Math.min(item.depth, 6) * 12}px`}
                >
                  <span>{item.name}</span><span class="muted numbers"
                    >{item.amountG == null ? '—' : number.format(item.amountG) + ' g cooked'}</span
                  >
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if active.portions.length}
          <div>
            <h3>Portions</h3>
            <ul class="list-reset">
              {#each active.portions as row (row.id)}<li class="component">
                  <span>
                    {row.label}
                    {#if row.sourceUrl && row.source !== productLabelSource}
                      <a href={row.sourceUrl} target="_blank" rel="noreferrer">Weight source</a>
                    {/if}
                  </span>
                  <span
                    >{row.source === agentPortionSource ||
                    (row.sourceUrl && row.source !== productLabelSource)
                      ? '≈ '
                      : ''}{number.format(row.grams)} g</span
                  >
                </li>{/each}
            </ul>
          </div>
        {/if}
        <form
          class="row search"
          onsubmit={(event) => {
            event.preventDefault();
            void savePreference({ portionG: portion ?? null, portionUnit });
          }}
        >
          {#if savedUnits.length > 1}
            <label
              >Portion unit
              <select
                bind:value={portionUnit}
                onchange={(event) => {
                  const unit = event.currentTarget.value;
                  portion = active?.portions.find(
                    (row) => row.source === 'user' && row.unit === unit
                  )?.grams;
                }}
              >
                {#each savedUnits as unit (unit)}
                  <option value={unit}>{portionUnitName(unit)}</option>
                {/each}
              </select>
            </label>
          {/if}
          <label
            >{portionUnit === 'portion' ? 'My serving (g)' : 'My weight per unit (g)'}
            <input type="number" min="0.01" step="any" bind:value={portion} />
          </label>
          <button class="button" type="submit">Save serving</button>
        </form>
        {#if notice}<p role="status" class="small success">{notice}</p>{/if}
        <LogForm
          id={active.id}
          kind="food"
          defaultPortion={active.portions.some(({ isDefault }) => isDefault)}
        />
      </aside>
    {/if}
  </div>
</section>

<Modal title="Add custom food" bind:this={modal}>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void createFood();
    }}
  >
    <label
      >Food name <input
        required
        maxlength="200"
        data-initial-focus
        bind:value={customName}
      /></label
    >
    <label
      >Energy per 100 g (kcal)<input
        required
        type="number"
        min="0"
        step="any"
        bind:value={customKcal}
      /></label
    >
    <label
      >Protein per 100 g (g)<input
        type="number"
        min="0"
        step="any"
        bind:value={customProtein}
      /></label
    >
    <details>
      <summary>More nutrients per 100 g</summary>
      {#each trackedNutrientGroups as group (group.title)}
        <h3>{group.title}</h3>
        {#each group.nutrients as { id, name, unit } (id)}
          {#if id !== 'energy_kcal' && id !== 'protein_g'}
            <label>
              {name} ({unit})
              <input type="number" min="0" step="any" bind:value={customNutrients[id]} />
            </label>
          {/if}
        {/each}
      {/each}
    </details>
    <ErrorNotice message={customProblem} retry={() => void createFood()} />
    <button class="button primary" type="submit" disabled={creating}>Save food</button>
  </form>
</Modal>

<style>
  .page-heading {
    margin-bottom: 0;
  }
  .search {
    align-items: end;
  }
  .search label:first-child {
    flex: 1;
    min-width: 135px;
  }
  header {
    justify-content: space-between;
  }
  .result {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    padding: 12px 9px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    text-decoration: none;
  }
  .result:hover,
  .result.selected {
    background: var(--accent-soft);
    border-radius: var(--control-radius);
  }
  .result small {
    display: block;
    color: var(--muted);
    margin-top: 2px;
  }
  .component,
  .nutrient-table div {
    display: flex;
    justify-content: space-between;
    gap: 7px;
    font-size: 0.83rem;
    padding: 4px 0;
  }
  .nutrient-table dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
