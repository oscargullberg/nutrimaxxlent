<script lang="ts">
  let { message, retry }: { message: string; retry?: () => void } = $props();
</script>

{#if message}
  <div class="error row" role="alert">
    <span>{message}</span>
    {#if retry}<button class="button" type="button" onclick={retry}>Try again</button>{/if}
  </div>
{/if}
