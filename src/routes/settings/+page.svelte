<script lang="ts">
  import { onMount } from 'svelte';
  import { api, problemMessage } from '#lib/client/api.ts';
  import type { ProviderStatus, Settings, Source } from '#lib/client/types.ts';
  import ErrorNotice from '#lib/components/ErrorNotice.svelte';

  const nutrients = [
    { key: 'kcal', label: 'Energy (kcal)' },
    { key: 'proteinG', label: 'Protein (g)' },
    { key: 'fatG', label: 'Fat (g)' },
    { key: 'carbsG', label: 'Carbs (g)' },
    { key: 'fiberG', label: 'Fiber (g)' }
  ] as const;
  const timezones = Intl.supportedValuesOf('timeZone');
  let sources = $state<Source[]>([]);
  let status = $state<ProviderStatus | null>(null);
  let settings = $state<Settings | null>(null);
  let targets = $state<Record<(typeof nutrients)[number]['key'], number | undefined>>({
    kcal: undefined,
    proteinG: undefined,
    fatG: undefined,
    carbsG: undefined,
    fiberG: undefined
  });
  let timezone = $state('');
  let locale = $state('');
  let provider = $state<'default' | 'codex' | 'fake'>('default');
  let model = $state('');
  let autoCommit = $state(true);
  let threshold = $state<number | undefined>();
  let loading = $state(true);
  let saving = $state(false);
  let testing = $state(false);
  let problem = $state('');
  let providerProblem = $state('');
  let notice = $state('');
  let tested = $state('');

  function assign(data: Settings) {
    settings = data;
    timezone = data.profile.timezone;
    locale = data.profile.locale;
    provider = data.profile.provider ?? 'default';
    model = data.profile.model ?? '';
    autoCommit = data.profile.autoCommit;
    threshold = data.profile.estimateKcalThreshold;
    for (const { key } of nutrients) targets[key] = data.goals?.[key] ?? undefined;
  }

  async function load() {
    loading = true;
    problem = '';
    try {
      const [data, connection, meta] = await Promise.all([
        api<Settings>('/api/settings'),
        api<ProviderStatus>('/api/provider/status'),
        api<{ sources: Source[] }>('/api/meta/sources')
      ]);
      assign(data);
      status = connection;
      sources = meta.sources;
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      loading = false;
    }
  }
  onMount(() => void load());

  async function save() {
    if (saving) return;
    saving = true;
    problem = '';
    providerProblem = '';
    notice = '';
    tested = '';
    try {
      const goals = Object.fromEntries(nutrients.map(({ key }) => [key, targets[key] ?? null]));
      assign(
        await api<Settings>('/api/settings', {
          method: 'PATCH',
          data: {
            timezone,
            locale,
            provider: provider === 'default' ? null : provider,
            model: model || null,
            autoCommit,
            estimateKcalThreshold: threshold,
            goals
          }
        })
      );
      status = await api<ProviderStatus>('/api/provider/status');
      notice = 'Settings saved.';
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      saving = false;
    }
  }

  async function testConnection() {
    if (testing) return;
    testing = true;
    providerProblem = '';
    tested = '';
    try {
      status = await api<ProviderStatus>('/api/provider/test', { method: 'POST' });
      tested = 'Connection test passed.';
    } catch (error) {
      providerProblem = problemMessage(error);
    } finally {
      testing = false;
    }
  }
</script>

<svelte:head><title>Settings · Nutrimaxxlent</title></svelte:head>
<section class="page stack">
  <div class="page-heading">
    <div>
      <h1>Settings</h1>
      <p class="muted">Manage your logging preferences and local data.</p>
    </div>
  </div>
  <ErrorNotice message={problem} retry={settings ? () => void save() : () => void load()} />
  {#if loading}
    <div class="panel muted" role="status">Loading settings…</div>
  {:else if settings}
    <form
      class="stack"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div class="settings-grid">
        <section class="panel stack" aria-label="Provider settings">
          <div class="row heading">
            <h2>Chat provider</h2>
            {#if status}<span class:connected={status.connected} class="connection"
                >{status.connected ? 'Connected' : 'Disconnected'}</span
              >{/if}
          </div>
          <label
            >Provider
            <select bind:value={provider}>
              <option value="default">Use local configuration</option>
              <option value="codex">ChatGPT via Codex</option>
              <option value="fake">Deterministic test provider</option>
            </select>
          </label>
          <label
            >Model <input
              bind:value={model}
              placeholder={settings.runtime.model}
              maxlength="80"
            /></label
          >
          {#if status}
            <p class="muted small">Active model <span class="code">{status.model}</span></p>
            {#if !status.connected}<p class="muted small">
                Run <code class="code">npx @openai/codex login</code>, then test the connection.
                <span class="code">{status.code}</span>
              </p>{/if}
          {/if}
          <div class="row">
            <button type="button" class="button" onclick={testConnection} disabled={testing}
              >{testing ? 'Testing…' : 'Test connection'}</button
            >
            {#if tested}<p class="success small" role="status">{tested}</p>{/if}
          </div>
          <ErrorNotice message={providerProblem} retry={() => void testConnection()} />
        </section>

        <section class="panel stack" aria-label="Logging preferences">
          <h2>Logging preferences</h2>
          <label>Timezone <input bind:value={timezone} list="timezones" required /></label>
          <datalist id="timezones">
            <option value="UTC"></option>
            {#each timezones as zone (zone)}<option value={zone}></option>{/each}
          </datalist>
          <label>Locale <input bind:value={locale} required placeholder="en or sv-SE" /></label>
          <label class="row check"
            ><input type="checkbox" bind:checked={autoCommit} /> Automatically log clear matches</label
          >
          <label
            >Ask before estimates above (kcal)
            <input type="number" min="0" max="10000" step="any" required bind:value={threshold} />
          </label>
        </section>

        <section class="panel stack" aria-label="Daily goals">
          <h2>Daily goals</h2>
          <div class="goal-fields">
            {#each nutrients as { key, label } (key)}
              <label
                >{label}
                <input
                  type="number"
                  min="0"
                  step="any"
                  bind:value={targets[key]}
                  placeholder="Unset"
                /></label
              >
            {/each}
          </div>
        </section>
      </div>
      <div class="row">
        <button type="submit" class="button primary" disabled={saving}
          >{saving ? 'Saving…' : 'Save settings'}</button
        >
        {#if notice}<p class="success" role="status">{notice}</p>{/if}
      </div>
    </form>
    <div class="settings-grid">
      <section class="panel stack" aria-label="Data sources">
        <h2>Data sources</h2>
        {#each sources as source (source.id)}
          <div class="source stack">
            <div class="row heading">
              <a href={source.homepage} target="_blank" rel="noreferrer"
                ><strong>{source.name}</strong></a
              ><span class="small muted">{source.license}</span>
            </div>
            <p class="small">{source.attribution}</p>
            <p class="small muted">
              <span class="code">{source.version}</span>{source.lastImportedAt
                ? ' · Imported ' +
                  new Date(source.lastImportedAt).toLocaleDateString(settings.profile.locale)
                : ''}
            </p>
          </div>
        {:else}
          <p class="muted">
            No datasets imported. Run <code class="code">pnpm data:refresh slv</code> to get started.
          </p>
        {/each}
      </section>
      <section class="panel stack" aria-label="Export">
        <h2>Export</h2>
        <p class="small muted">
          Download a JSON copy of your logs, chats, recipes, and preferences.
        </p>
        <div>
          <a class="button" href="/api/export" data-sveltekit-reload download>Export my data</a>
        </div>
      </section>
    </div>
  {/if}
</section>

<style>
  .page-heading {
    margin-bottom: 0;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: start;
  }
  .heading {
    justify-content: space-between;
  }
  .connection {
    background: var(--warning-soft);
    color: var(--warning);
    border-radius: var(--control-radius);
    padding: 4px 9px;
    font-size: 0.78rem;
    font-weight: 650;
  }
  .connection.connected {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .goal-fields {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  }
  .source {
    gap: 4px;
    border-top: 1px solid var(--line);
    padding-top: 9px;
  }
  @media (max-width: 850px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
