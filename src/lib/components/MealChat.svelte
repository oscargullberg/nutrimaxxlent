<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, chatStream, problemMessage } from '#lib/client/api.ts';
  import type {
    ChatInput,
    Conversation,
    Entry,
    HistoryMatch,
    Message,
    Pending,
    Thread
  } from '#lib/client/types.ts';
  import ErrorNotice from '#lib/components/ErrorNotice.svelte';
  import LogCard from '#lib/components/LogCard.svelte';
  import MealReview from '#lib/components/MealReview.svelte';

  let {
    date,
    onchange,
    children
  }: { date?: string; onchange?: (date: string) => void; children?: Snippet } = $props();

  let threads = $state<Thread[]>([]);
  let selected = $state<Thread | null>(null);
  let messages = $state<Message[]>([]);
  let entries = $state<Record<string, Entry>>({});
  let historyOpen = $state(false);
  let query = $state('');
  let lastQuery = $state('');
  let matches = $state<HistoryMatch[]>([]);
  let text = $state('');
  let streamText = $state('');
  let loading = $state(true);
  let sending = $state(false);
  let activeTurnId = $state<string | null>(null);
  let pendingMessageId = $state<string | null>(null);
  let interruptedTurnId = $state<string | null>(null);
  let stopRequestedFor = $state<string | null>(null);
  let busy = $derived(sending || activeTurnId !== null);
  let changingThread = $state(false);
  let problem = $state('');
  let composer = $state<HTMLTextAreaElement>();
  let transcript = $state<HTMLDivElement>();
  let sendController: AbortController | undefined;
  let reloadId = 0;
  let searchId = 0;

  function findPart<P>(message: Message, type: string): P | undefined {
    return message.parts.find(
      (part) => typeof part === 'object' && part !== null && 'type' in part && part.type === type
    ) as P | undefined;
  }

  function entryLinks(message: Message) {
    return message.parts.filter(
      (part): part is { type: 'entry'; entryId: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'entry' &&
        'entryId' in part &&
        typeof part.entryId === 'string'
    );
  }

  async function loadThread(id: string, polling = false) {
    const version = ++reloadId;
    const result = await api<Conversation>(`/api/threads/${id}/messages`);
    if (version !== reloadId) return;
    if (!date && result.thread.date) {
      void goto(`/today?date=${result.thread.date}&log=1`);
      return;
    }
    if (polling && result.activeTurnId && result.messages.at(-1)?.id === messages.at(-1)?.id) {
      activeTurnId = result.activeTurnId;
      if (activeTurnId !== stopRequestedFor) stopRequestedFor = null;
      return result;
    }
    const ids = new Set(
      result.messages.flatMap((message) => entryLinks(message).map(({ entryId }) => entryId))
    );
    const loaded = await Promise.all(
      [...ids].map((entryId) => api<{ entry: Entry }>(`/api/entries/${entryId}`))
    );
    if (version !== reloadId) return;
    selected = result.thread;
    if (!date) sessionStorage.setItem('nutrimaxlent.thread', id);
    threads = threads.map((thread) => (thread.id === id ? result.thread : thread));
    messages = result.messages;
    entries = Object.fromEntries(loaded.map(({ entry }) => [entry.id, entry]));
    activeTurnId = result.activeTurnId;
    if (activeTurnId !== stopRequestedFor) stopRequestedFor = null;
    pendingMessageId = result.pendingMessageId;
    interruptedTurnId = result.interruptedTurnId;
    if (date && !activeTurnId && loaded.length) onchange?.(date);
    await scrollToLatest();
    return result;
  }

  async function scrollToLatest() {
    await tick();
    transcript?.scrollTo({ top: transcript.scrollHeight });
  }

  async function list() {
    threads = (await api<{ threads: Thread[] }>('/api/threads')).threads;
    if (selected) selected = threads.find(({ id }) => id === selected?.id) ?? selected;
  }

  async function refresh() {
    if (sending) return;
    let version = ++reloadId;
    problem = '';
    loading = true;
    try {
      let id: string | undefined;
      if (date) {
        const { threads: dailyThreads } = await api<{ threads: Thread[] }>(
          `/api/threads?date=${date}&archived=true`
        );
        id = dailyThreads[0]?.id;
      } else {
        await list();
        const previous = sessionStorage.getItem('nutrimaxlent.thread');
        id =
          currentUrl().searchParams.get('thread') ??
          selected?.id ??
          threads.find((thread) => thread.id === previous)?.id;
      }
      if (version === reloadId && id) {
        version = reloadId + 1;
        await loadThread(id);
      }
    } catch (error) {
      if (version === reloadId) problem = problemMessage(error);
    } finally {
      if (version === reloadId) loading = false;
    }
  }

  function refreshOnFocus() {
    if (selected && !busy && !loading) void loadThread(selected.id).catch(() => undefined);
  }

  onMount(() => {
    void refresh();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      detachStream();
    };
  });

  $effect(() => {
    const threadId = selected?.id;
    if (!threadId || !activeTurnId || sending || loading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await loadThread(threadId!, true);
      } catch {
        // A brief connection loss should not replace the saved conversation.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  function currentUrl() {
    return page.shallow?.url ?? page.url;
  }

  function locate(id?: string) {
    const url = new URL(currentUrl().href);
    if (id) {
      sessionStorage.setItem('nutrimaxlent.thread', id);
      url.searchParams.set('thread', id);
    } else {
      sessionStorage.removeItem('nutrimaxlent.thread');
      url.searchParams.delete('thread');
    }
    void goto(url, { state: page.state, shallow: true, replace: true });
  }

  function detachStream() {
    const controller = sendController;
    sendController = undefined;
    controller?.abort();
    ++reloadId;
    sending = false;
    streamText = '';
    activeTurnId = null;
    stopRequestedFor = null;
    pendingMessageId = null;
    interruptedTurnId = null;
  }

  async function selectThread(id: string) {
    if (selected?.id === id) return;
    detachStream();
    selected = null;
    messages = [];
    entries = {};
    text = '';
    problem = '';
    loading = true;
    locate(id);
    const version = reloadId + 1;
    try {
      await loadThread(id);
    } catch (error) {
      if (version === reloadId) problem = problemMessage(error);
    } finally {
      if (version === reloadId) loading = false;
    }
  }

  function newChat() {
    detachStream();
    historyOpen = false;
    loading = false;
    messages = [];
    entries = {};
    selected = null;
    problem = '';
    text = '';
    locate();
    void tick().then(() => composer?.focus());
  }

  async function archive() {
    const thread = selected;
    if (!thread || busy || changingThread) return;
    changingThread = true;
    try {
      await api(`/api/threads/${thread.id}`, { method: 'DELETE' });
      newChat();
      await list();
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      changingThread = false;
    }
  }

  async function removeThread() {
    const thread = selected;
    if (!thread || busy || changingThread) return;
    if (
      !window.confirm(
        `Permanently delete “${thread.title}” and its messages? Your logged meals will be kept.`
      )
    )
      return;
    changingThread = true;
    problem = '';
    try {
      await api(`/api/threads/${thread.id}?permanent=true`, { method: 'DELETE' });
      newChat();
      threads = threads.filter(({ id }) => id !== thread.id);
      if (lastQuery) await searchThreads();
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      changingThread = false;
    }
  }

  async function restore() {
    const thread = selected;
    if (!thread?.archivedAt || changingThread) return;
    changingThread = true;
    try {
      await api(`/api/threads/${thread.id}`, { method: 'PATCH', data: { archived: false } });
      await loadThread(thread.id);
      if (!date) await list();
    } catch (error) {
      problem = problemMessage(error);
    } finally {
      changingThread = false;
    }
  }

  async function searchThreads() {
    const version = ++searchId;
    const term = query.trim();
    lastQuery = term;
    matches = [];
    if (!term) return;
    try {
      const result = await api<{ matches: HistoryMatch[] }>(
        `/api/search?q=${encodeURIComponent(term)}`
      );
      if (version === searchId) matches = result.matches;
    } catch (error) {
      if (version === searchId) problem = problemMessage(error);
    }
  }

  async function send(input: ChatInput) {
    if (busy || loading || changingThread) return;
    ++reloadId;
    sending = true;
    streamText = '';
    problem = '';
    const controller = new AbortController();
    sendController = controller;
    let thread = selected;
    let stored = false;
    try {
      if (!thread) {
        thread = (await api<{ thread: Thread }>('/api/threads', { method: 'POST', data: { date } }))
          .thread;
        if (sendController !== controller) return;
        selected = thread;
        if (!date) {
          threads = [thread, ...threads];
          locate(thread.id);
        }
      }
      for await (const event of chatStream(thread.id, input, controller.signal)) {
        if (sendController !== controller) return;
        if (event.type === 'message') {
          messages = [...messages, event.data.message];
          stored = true;
          if (event.data.message.role === 'assistant') streamText = '';
          else activeTurnId = input.messageId;
        } else if (event.type === 'text') streamText += event.data.delta;
        else if (event.type === 'tool' && event.data.name === 'lookup_portion')
          streamText = 'Resolving a typical portion weight…';
        else if (event.type === 'tool' && event.data.name === 'lookup_product')
          streamText = 'Looking up the product label…';
        else if (event.type === 'committed') entries[event.data.entry.id] = event.data.entry;
        await scrollToLatest();
      }
      if (sendController !== controller) return;
      await loadThread(thread.id);
      if (sendController === controller && !date) await list();
    } catch (error) {
      if (sendController !== controller) return;
      const latest = thread ? await loadThread(thread.id).catch(() => undefined) : undefined;
      if (sendController !== controller) return;
      const accepted = stored || latest?.messages.some(({ id }) => id === input.messageId);
      const last = latest?.messages.at(-1);
      const failed =
        last &&
        findPart(last, 'error') &&
        findPart<{ userMessageId: string }>(last, 'reply')?.userMessageId === input.messageId;
      if (failed || (!latest?.activeTurnId && !accepted)) problem = problemMessage(error);
      if ((!thread || latest) && !accepted && input.kind === 'message') text = input.text;
    } finally {
      if (sendController === controller) {
        streamText = '';
        sending = false;
        sendController = undefined;
        await tick();
        composer?.focus({ preventScroll: true });
      }
    }
  }

  async function stop() {
    const threadId = selected?.id;
    const turnId = activeTurnId;
    if (!threadId || !turnId || stopRequestedFor === turnId) return;
    stopRequestedFor = turnId;
    try {
      await api(`/api/threads/${threadId}/messages?turn=${turnId}`, { method: 'DELETE' });
    } catch (error) {
      if (selected?.id === threadId && activeTurnId === turnId) {
        stopRequestedFor = null;
        problem = problemMessage(error);
      }
    }
  }

  function retryText(message: Message) {
    const userId =
      message.id === interruptedTurnId
        ? message.id
        : findPart(message, 'error') &&
          findPart<{ userMessageId: string }>(message, 'reply')?.userMessageId;
    const user = messages.find(({ id }) => id === userId);
    const turn = user && findPart<{ kind?: ChatInput['kind'] }>(user, 'turn');
    return user && (!turn || turn.kind === 'message') ? user.content : undefined;
  }

  function submit() {
    const value = text.trim();
    if (!value || busy || loading || changingThread) return;
    text = '';
    void send({ kind: 'message', text: value, messageId: crypto.randomUUID() });
  }
</script>

{#if !date}
  <div class="poster">
    <div class="poster-copy">
      <h1>Chat history</h1>
    </div>
  </div>
{/if}
<div class="chat-layout" class:daily={date}>
  {#if !date}
    <aside class="panel stack threads">
      <div class="row rail-heading">
        <h2 class="rail-title">Threads</h2>
        <button
          class="button history-toggle"
          type="button"
          aria-controls="chat-history"
          aria-expanded={historyOpen}
          onclick={() => (historyOpen = !historyOpen)}
        >
          Threads <span aria-hidden="true">{historyOpen ? '−' : '+'}</span>
        </button>
        <button class="button" type="button" disabled={changingThread} onclick={newChat}
          >New chat</button
        >
      </div>
      <div class="stack history-content" class:expanded={historyOpen} id="chat-history">
        <form
          role="search"
          class="stack"
          onsubmit={(event) => {
            event.preventDefault();
            void searchThreads();
          }}
        >
          <label for="chat-search">Search history</label>
          <input
            id="chat-search"
            type="search"
            bind:value={query}
            oninput={(event) => {
              if (!event.currentTarget.value.trim()) {
                ++searchId;
                matches = [];
                lastQuery = '';
              }
            }}
            placeholder="Search food or conversation"
          />
        </form>
        <div class="thread-list">
          {#if lastQuery}
            {#each matches as match (match.id)}
              {#if match.threadId}
                <button
                  type="button"
                  class="thread-button"
                  disabled={changingThread}
                  onclick={() => selectThread(match.threadId!)}
                >
                  <strong>{match.title ?? 'Chat'}</strong><span>{match.text}</span>
                </button>
              {:else if match.logDate}
                <a class="thread-button" href={`/today?date=${match.logDate}`}
                  ><strong>{match.title ?? 'Meal entry'}</strong><span>{match.text}</span></a
                >
              {/if}
            {:else}<p class="small muted">No matches for “{lastQuery}”.</p>{/each}
          {:else}
            {#each threads as thread (thread.id)}
              <button
                type="button"
                class="thread-button"
                class:active={selected?.id === thread.id}
                disabled={changingThread}
                onclick={() => selectThread(thread.id)}
              >
                <strong>{thread.title}</strong>
              </button>
            {:else}
              {#if !loading}<p class="small muted">Your conversations will appear here.</p>{/if}
            {/each}
          {/if}
        </div>
      </div>
    </aside>
  {/if}

  <div class="panel conversation">
    {@render children?.()}
    {#if selected && (!date || selected.archivedAt)}
      <div class="conversation-heading row">
        <h2>{selected.title}</h2>
        <div class="row">
          {#if selected.archivedAt}
            <button class="button" type="button" disabled={changingThread} onclick={restore}
              >Restore thread</button
            >
          {:else}
            <button
              class="button quiet"
              type="button"
              disabled={busy || changingThread}
              onclick={archive}>Archive</button
            >
          {/if}
          {#if !date}<button
              class="button quiet danger"
              type="button"
              disabled={busy || changingThread}
              onclick={removeThread}>Delete thread</button
            >{/if}
        </div>
      </div>
    {/if}

    <div class="messages stack" aria-busy={busy} bind:this={transcript}>
      {#if loading}<p class="muted" role="status">Loading chat…</p>
      {:else if !date && messages.length === 0 && !busy}
        <div class="welcome">
          <h2>What did you eat?</h2>
          <div class="row" role="group" aria-label="Example meals">
            {#each ['avg carbonara serving', '150 g cooked rice'] as example (example)}
              <button
                class="button"
                type="button"
                onclick={() => {
                  text = example;
                  composer?.focus();
                }}>{example}</button
              >
            {/each}
          </div>
        </div>
      {/if}
      {#each messages as message (message.id)}
        {@const pending = findPart<Pending>(message, 'pending')}
        {@const retry = message.id === messages.at(-1)?.id ? retryText(message) : undefined}
        <div class:user={message.role === 'user'} class="message">
          <p class="bubble">{message.content}</p>
          {#each entryLinks(message) as { entryId } (entryId)}
            {#if entries[entryId]}
              <LogCard
                entry={entries[entryId]!}
                {date}
                onlogged={() => {
                  if (date) onchange?.(date);
                }}
                onchange={(entry) => {
                  entries[entry.id] = entry;
                  if (date) onchange?.(date);
                }}
              />
            {/if}
          {/each}
          {#if pending && message.id === pendingMessageId && !selected?.archivedAt}
            <MealReview
              {pending}
              disabled={busy || changingThread}
              onconfirm={(answers, replacements) => {
                const reply = {
                  replyTo: message.id,
                  messageId: crypto.randomUUID(),
                  replacements
                };
                if (pending.clarification) {
                  void send({
                    ...reply,
                    kind: 'clarify',
                    selection: { answers }
                  });
                } else {
                  void send({ ...reply, kind: 'confirm' });
                }
              }}
            />
          {/if}
          {#if message.id === interruptedTurnId}
            <p class="small muted">This turn was interrupted before a reply was saved.</p>
          {/if}
          {#if retry && !busy && !selected?.archivedAt}
            <button
              class="button"
              type="button"
              disabled={changingThread}
              onclick={() => send({ kind: 'message', text: retry, messageId: crypto.randomUUID() })}
              >Retry message</button
            >
          {/if}
        </div>
      {/each}
      {#if busy}
        <p class="bubble muted" role="status">{streamText || 'Resolving your message…'}</p>
      {/if}
    </div>

    <ErrorNotice message={problem} retry={() => void refresh()} />
    {#if !selected?.archivedAt}
      <form
        class="composer"
        onsubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label for="conversation-input" class="sr-only">Describe your meal</label>
        <textarea
          id="conversation-input"
          rows="2"
          placeholder="Describe your meal…"
          disabled={busy || loading || changingThread}
          bind:value={text}
          bind:this={composer}
          onkeydown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              submit();
            }
          }}></textarea>
        {#if busy}
          <button
            class="button"
            type="button"
            disabled={!activeTurnId || stopRequestedFor === activeTurnId}
            onclick={stop}>{stopRequestedFor ? 'Stopping…' : 'Stop'}</button
          >
        {:else}<button
            class="button primary"
            type="submit"
            disabled={!text.trim() || loading || changingThread}>Send</button
          >{/if}
      </form>
    {/if}
  </div>
</div>

<style>
  .poster {
    position: relative;
    isolation: isolate;
    display: grid;
    align-items: center;
    min-height: clamp(112px, 14vw, 166px);
    margin-bottom: 20px;
    padding: clamp(18px, 2.8vw, 36px);
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background-color: var(--paper);
  }
  .poster::before {
    position: absolute;
    z-index: -1;
    inset: 0 0 0 38%;
    background: url('/theme/stencil.webp') right 55% / cover no-repeat;
    mask-image: linear-gradient(to right, transparent, black);
    opacity: 0.25;
    pointer-events: none;
    content: '';
  }
  .chat-layout {
    display: grid;
    grid-template-columns: minmax(210px, 264px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .daily {
    grid-template-columns: minmax(0, 1fr);
  }
  .daily .conversation {
    min-height: 0;
  }
  .daily .messages {
    min-height: 0;
  }
  .daily .messages:empty {
    display: none;
  }
  .daily .composer {
    padding-top: 0;
    border-top: 0;
  }
  .threads {
    align-content: start;
  }
  .rail-heading,
  .conversation-heading {
    justify-content: space-between;
  }
  .history-toggle {
    display: none;
  }
  .thread-list {
    max-height: 52dvh;
    overflow: auto;
  }
  .thread-button {
    display: grid;
    width: 100%;
    gap: 3px;
    text-align: left;
    text-decoration: none;
    min-height: var(--touch-target);
    padding: 9px 11px;
    border-inline-start: 2px solid transparent;
    border-radius: var(--control-radius);
  }
  .thread-button.active,
  .thread-button:hover {
    background: var(--accent-soft);
  }
  .thread-button.active {
    color: var(--accent);
    border-inline-start-color: var(--accent);
  }
  .thread-button strong,
  .thread-button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.86rem;
  }
  .thread-button span {
    color: var(--muted);
  }
  .conversation {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: min(550px, 56dvh);
  }
  .conversation-heading {
    border-bottom: 1px solid var(--line);
    padding-bottom: 8px;
  }
  .messages {
    align-content: start;
    flex: 1;
    min-height: 240px;
    max-height: 52dvh;
    overflow-y: auto;
    padding: 3px;
  }
  .message {
    display: grid;
    gap: 8px;
    max-width: min(100%, 640px);
    justify-self: start;
  }
  .bubble {
    max-width: fit-content;
    border: 1px solid var(--line);
    border-radius: var(--control-radius);
    background: var(--paper);
    padding: 10px 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .message.user {
    justify-self: end;
    max-width: 88%;
  }
  .user .bubble {
    background: var(--accent-soft);
    border-color: var(--control-line);
  }
  .welcome {
    display: grid;
    justify-items: start;
    gap: 14px;
    padding: clamp(18px, 5dvh, 50px) clamp(4px, 2vw, 20px);
  }
  .welcome h2 {
    font-size: clamp(1.65rem, 4vw, 2.5rem);
    line-height: 1.15;
    letter-spacing: -0.035em;
  }
  .composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .composer textarea {
    min-height: 56px;
    padding: 12px;
  }
  .composer .button {
    min-width: 74px;
  }
  @media (max-width: 690px) {
    .chat-layout {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .threads {
      padding-block: 10px;
    }
    .rail-title,
    .history-content:not(.expanded) {
      display: none;
    }
    .history-toggle {
      display: inline-flex;
    }
    .thread-list {
      max-height: 132px;
    }
    .conversation {
      min-height: 0;
    }
    .messages {
      min-height: 190px;
    }
    .welcome {
      padding-block: 18px;
    }
  }
  @media (max-width: 460px) {
    .poster {
      margin-bottom: 12px;
    }
    .poster::before {
      opacity: 0.16;
    }
    .welcome {
      padding-block: 10px;
    }
  }
  @media (forced-colors: active) {
    .poster::before {
      display: none;
    }
  }
</style>
