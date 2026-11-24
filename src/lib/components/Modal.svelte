<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';

  let { title, children, onclose }: { title: string; children: Snippet; onclose?: () => void } =
    $props();
  const id = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let trigger: HTMLElement | null = null;

  export async function open() {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
  }

  export function close() {
    dialog?.close();
  }

  function closed() {
    trigger?.focus();
    trigger = null;
    onclose?.();
  }
</script>

<dialog bind:this={dialog} onclose={closed} aria-labelledby={id} class="panel">
  <header class="row">
    <h2 {id}>{title}</h2>
    <button class="button quiet" type="button" onclick={close}>Close</button>
  </header>
  {@render children()}
</dialog>

<style>
  dialog {
    inset: 0;
    margin: auto;
    width: min(540px, calc(100vw - 26px));
    max-height: 86dvh;
    color: var(--ink);
    padding: 20px;
  }
  dialog::backdrop {
    background: #060805b8;
  }
  header {
    justify-content: space-between;
    margin-bottom: 12px;
  }
</style>
