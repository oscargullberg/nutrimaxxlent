<script lang="ts">
  import { api, problemMessage } from '../client/api';
  import type { Entry } from '../client/types';
  import { mealSections, sectionLabel } from '../meal-sections';
  import { maxMealTitleLength } from '../meal-title';
  import { mealLabels, mealTypes, type MealType } from '../meal-types';
  import ErrorNotice from './ErrorNotice.svelte';
  import Modal from './Modal.svelte';

  let { entry, onchange }: { entry: Entry; onchange: (entry: Entry) => void } = $props();
  let dialog: ReturnType<typeof Modal>;
  let groups = $state<{ title: string; meal: MealType }[]>([]);
  let assignments = $state<Record<string, number>>({});
  let problem = $state('');
  let saving = $state(false);
  let assigned = $derived(
    groups.map((group, index) => ({
      ...group,
      itemIds: entry.items.filter(({ id }) => assignments[id] === index).map(({ id }) => id)
    }))
  );
  let ready = $derived(
    assigned.length > 1 &&
      assigned.every(({ title, itemIds }) => title.trim() && itemIds.length) &&
      assigned.reduce((total, group) => total + group.itemIds.length, 0) === entry.items.length
  );

  export function open() {
    groups = mealSections(entry.rawText).map((section) => ({
      title: sectionLabel(section),
      meal: section.meal ?? 'other'
    }));
    assignments = Object.fromEntries(entry.items.map(({ id }) => [id, -1]));
    problem = '';
    void dialog.open();
  }

  async function save() {
    if (!ready || saving) return;
    saving = true;
    problem = '';
    try {
      const result = await api<{ entry: Entry }>(`/api/entries/${entry.id}/split`, {
        method: 'POST',
        data: { groups: assigned }
      });
      dialog.close();
      onchange(result.entry);
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      saving = false;
    }
  }
</script>

<Modal title="Split meal" bind:this={dialog}>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <p class="muted small">
      Assign each food to a meal. Portions and nutrient values stay the same.
    </p>
    {#each entry.items as item (item.id)}
      <label>
        {item.label}
        <select bind:value={assignments[item.id]} disabled={saving} required>
          <option value={-1} disabled>Choose meal</option>
          {#each groups as group, index (index)}
            <option value={index}>{group.title}</option>
          {/each}
        </select>
      </label>
    {/each}
    {#each groups as group, index (index)}
      <div class="row group">
        <label
          >Meal {index + 1} name
          <input
            bind:value={group.title}
            maxlength={maxMealTitleLength}
            disabled={saving}
            required
          />
        </label>
        <label
          >Category
          <select bind:value={group.meal} disabled={saving}>
            {#each mealTypes as type (type)}
              <option value={type}>{mealLabels[type]}</option>
            {/each}
          </select>
        </label>
      </div>
    {/each}
    <ErrorNotice message={problem} />
    <button class="button primary" type="submit" disabled={!ready || saving}>Save split</button>
  </form>
</Modal>

<style>
  .group {
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }
</style>
