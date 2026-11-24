<script lang="ts">
  import { problemMessage } from '../client/api';
  import type { CatalogSelection } from '../server/agent/proposal';
  import ErrorNotice from './ErrorNotice.svelte';
  import FoodPicker, { type Choice } from './FoodPicker.svelte';
  import Modal from './Modal.svelte';

  let {
    onreplace
  }: { onreplace: (replacement: CatalogSelection, choice: Choice) => void | Promise<void> } =
    $props();
  let modal: ReturnType<typeof Modal>;
  let original = $state('');
  let weight: number | undefined;
  let chosen = $state<Choice | null>(null);
  let amount = $state<number | undefined>();
  let busy = $state(false);
  let problem = $state('');
  let session = $state(0);

  export function open(label: string, grams?: number) {
    if (busy) return;
    original = label;
    weight = grams;
    chosen = null;
    problem = '';
    session++;
    void modal.open();
  }

  async function save() {
    if (busy || !chosen || !amount || amount <= 0) return;
    busy = true;
    problem = '';
    const replacement: CatalogSelection =
      chosen.kind === 'food'
        ? { kind: 'food', foodId: chosen.id, quantity: amount, unit: 'g' }
        : { kind: 'recipe', recipeId: chosen.id, servings: amount };
    try {
      await onreplace(replacement, chosen);
      modal.close();
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Replace item" bind:this={modal}>
  <p class="muted">Replacing {original}</p>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    {#key session}
      <FoodPicker
        onselect={(choice) => {
          chosen = choice;
          amount = choice.kind === 'food' ? (weight ?? 100) : 1;
        }}
      />
    {/key}
    {#if chosen}
      <strong>{chosen.name}</strong>
      <label>
        {chosen.kind === 'food' ? 'Grams' : 'Servings'}
        <input type="number" min="0.01" step="any" required bind:value={amount} disabled={busy} />
      </label>
    {/if}
    <ErrorNotice message={problem} retry={() => void save()} />
    <button type="submit" class="button primary" disabled={!chosen || busy}>Replace item</button>
  </form>
</Modal>
