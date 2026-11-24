<script lang="ts">
  import { page } from '$app/state';
  import '../app.css';

  let { children } = $props();
  const navigation = [
    { path: '/today', name: 'Today', mark: '◫' },
    { path: '/foods', name: 'Foods', mark: '◈' },
    { path: '/recipes', name: 'Recipes', mark: '▤' },
    { path: '/settings', name: 'Settings', mark: '⚙︎' }
  ];
</script>

<a class="skip" href="#main-content">Skip to content</a>
<div class="app-shell">
  <header class="masthead">
    <div class="masthead-inner">
      <a href="/today" class="brand" aria-label="Nutrimaxxlent home">Nutrimaxxlent</a>
      <nav aria-label="Main navigation">
        {#each navigation as item (item.path)}
          <a href={item.path} aria-current={page.url.pathname === item.path ? 'page' : undefined}>
            <span aria-hidden="true">{item.mark}</span>{item.name}
          </a>
        {/each}
      </nav>
    </div>
  </header>
  <main id="main-content" tabindex="-1">
    {@render children()}
  </main>
</div>

<style>
  .skip {
    position: fixed;
    z-index: 20;
    left: 12px;
    top: 12px;
    padding: 10px;
    background: var(--accent);
    color: var(--accent-ink);
    transform: translateY(-150%);
  }
  .skip:focus {
    transform: translateY(0);
  }
  .app-shell {
    min-height: 100dvh;
  }
  .masthead {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--nav);
    border-bottom: 1px solid var(--line);
    border-top: 1px solid var(--control-line);
  }
  .masthead-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    width: min(100%, 1380px);
    min-height: 68px;
    margin-inline: auto;
    padding-inline: var(--page-padding);
  }
  .masthead a {
    text-decoration: none;
  }
  .brand {
    font: 700 1.4rem/1 var(--font-display);
    letter-spacing: 0.055em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  nav {
    display: flex;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
  }
  nav a {
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch-target);
    padding: 8px clamp(9px, 1.3vw, 17px);
    border: 1px solid transparent;
    border-radius: var(--control-radius);
    font: 650 0.86rem/1 var(--font-mono);
    white-space: nowrap;
  }
  nav a span {
    min-width: 16px;
    text-align: center;
  }
  nav a:hover {
    color: var(--ink);
    background: var(--surface);
  }
  nav a[aria-current='page'] {
    background: var(--nav-active);
    color: var(--accent);
    border-color: var(--control-line);
    box-shadow: inset 0 -2px var(--accent);
  }
  main {
    min-width: 0;
    scroll-margin-top: 85px;
  }
  @media (max-width: 720px) {
    .masthead {
      position: relative;
    }
    .masthead-inner {
      align-items: flex-start;
      flex-direction: column;
      gap: 9px;
      padding-block: 12px 8px;
    }
    nav a {
      padding-inline: clamp(7px, 2vw, 13px);
      gap: 5px;
      font-size: 0.8rem;
    }
  }
  @media (max-width: 420px) {
    nav {
      width: 100%;
      justify-content: space-between;
      gap: 2px;
    }
    nav a {
      padding-inline: 4px;
    }
    nav a span {
      display: none;
    }
  }
</style>
