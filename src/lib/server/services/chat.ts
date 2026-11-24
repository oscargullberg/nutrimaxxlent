import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { mealSections } from '../../meal-sections.ts';
import { generatedMealTitle, mealTitle } from '../../meal-title.ts';
import { mealLabels } from '../../meal-types.ts';
import { runAgent } from '../agent/agent.ts';
import {
  continueClarification,
  replaceReviewItems,
  resolveForLogging,
  reviewedItems,
  type PendingClarification,
  type TurnResolution
} from '../agent/clarify.ts';
import { fixtureProvider } from '../agent/fake-fixtures.ts';
import { combineMealSections, mealsToCommit } from '../agent/grouped-meals.ts';
import { createPortionLookup } from '../agent/portion-lookup.ts';
import { createProductLookup } from '../agent/product-lookup.ts';
import {
  catalogSelection,
  maxMealGroups,
  maxReviewItems,
  proposalSchema,
  type Proposal
} from '../agent/proposal.ts';
import { AgentError } from '../agent/provider.ts';
import type { Database } from '../db/client.ts';
import { chatMessages, chatThreads } from '../db/schema.ts';
import { ApiError, errorDetails } from '../http/api.ts';
import { localDate } from '../nutrition/snapshots.ts';
import { commitEntry, localEntryTime } from './entries.ts';
import { createProvider, providerConfig } from './settings.ts';
import { appendMessage, getThread, messagesForThread, recentMessageLimit } from './threads.ts';
import { getProfile } from './totals.ts';

const uuid = z.uuid();
const optionId = z.string().regex(/^option-\d+$/u);
const grams = z.number().positive();
const reviewItemIndex = z
  .number()
  .int()
  .min(0)
  .max(maxReviewItems - 1);
const replacements = z
  .array(z.object({ itemIndex: reviewItemIndex, replacement: catalogSelection }))
  .max(maxReviewItems)
  .optional();
const selectionSchema = z.union([
  z.object({ optionId }),
  z.object({ grams }),
  z.object({
    answers: z
      .array(
        z.union([
          z.object({ itemIndex: reviewItemIndex, optionId }),
          z.object({ itemIndex: reviewItemIndex, grams })
        ])
      )
      .max(maxReviewItems)
  })
]);
export const chatInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    messageId: uuid.optional(),
    text: z.string().trim().min(1).max(3000)
  }),
  z.object({
    kind: z.literal('clarify'),
    messageId: uuid.optional(),
    replyTo: uuid,
    selection: selectionSchema,
    replacements
  }),
  z.object({ kind: z.literal('confirm'), messageId: uuid.optional(), replyTo: uuid, replacements })
]);

type ChatInput = z.output<typeof chatInput>;
type PendingPart = {
  type: 'pending';
  rawText: string;
  proposal: Proposal;
  clarification: PendingClarification | null;
  confirmed: number[];
  items?: TurnResolution['items'];
};
type Emit = (name: string, data: unknown) => void;

const activeTurns = new Map<string, { id: string; controller: AbortController }>();

export function activeChatTurn(threadId: string) {
  return activeTurns.get(threadId)?.id ?? null;
}

export function stopChatTurn(threadId: string, id: string) {
  const turn = activeTurns.get(threadId);
  if (turn?.id === id) turn.controller.abort();
}

function part<P>(value: unknown[] | undefined, type: string) {
  return value?.find(
    (item) => typeof item === 'object' && item !== null && 'type' in item && item.type === type
  ) as P | undefined;
}

function reviewId(messages: readonly (typeof chatMessages.$inferSelect)[], active: boolean) {
  const last = messages.at(-1);
  if (!last) return null;
  if (part<PendingPart>(last.parts, 'pending')) return last.id;
  const preserved = part<{ id: string }>(last.parts, 'review');
  if (preserved) return preserved.id;
  if (active) return null;
  if (last.role === 'user') return part<{ replyTo: string }>(last.parts, 'turn')?.replyTo ?? null;
  if (part(last.parts, 'error')) {
    const user = messages.at(-2);
    if (user?.id === part<{ userMessageId: string }>(last.parts, 'reply')?.userMessageId)
      return part<{ replyTo: string }>(user?.parts, 'turn')?.replyTo ?? null;
  }
  return null;
}

async function loadReview(db: Database, threadId: string, id: string) {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.id, id)));
  return message ?? null;
}

async function refreshLegacyReview(db: Database, pending: PendingPart | null) {
  if (!pending?.clarification) return pending;
  const { additional, code: primaryCode } = pending.clarification;
  const issues = [pending.clarification, ...(additional ?? [])];
  const unresolvedFoods = issues.filter(
    ({ code, itemIndex }) =>
      code === 'UNIT_UNRESOLVED' && pending.proposal.items[itemIndex]?.kind === 'food'
  );
  if (
    !unresolvedFoods.length &&
    (additional || !['LOW_CONFIDENCE', 'ESTIMATE_CONFIRMATION'].includes(primaryCode))
  )
    return pending;
  const profile = await getProfile(db);
  const resolution = await resolveForLogging(db, pending.proposal, {
    estimateThreshold: profile.estimateKcalThreshold,
    confirmed: pending.confirmed
  });
  if (unresolvedFoods.length) {
    const recovered = resolution.items.filter(({ itemIndex }) =>
      unresolvedFoods.some((issue) => issue.itemIndex === itemIndex)
    );
    if (!recovered.length) return pending;
    const resolvedIssues = resolution.clarification
      ? [resolution.clarification, ...(resolution.clarification.additional ?? [])]
      : [];
    const [first, ...remaining] = issues.flatMap((issue) =>
      issue.code === 'UNIT_UNRESOLVED' &&
      recovered.some(({ itemIndex }) => itemIndex === issue.itemIndex)
        ? resolvedIssues.filter(({ itemIndex }) => itemIndex === issue.itemIndex)
        : [issue]
    );
    return {
      ...pending,
      items: pending.items
        ? [...pending.items, ...recovered].toSorted(
            (a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0)
          )
        : resolution.items,
      clarification: first ? { ...first, additional: remaining } : null
    };
  }
  return { ...pending, items: resolution.items, clarification: resolution.clarification };
}

export async function chatMessagesForView(db: Database, id: string) {
  const activeBeforeRead = activeChatTurn(id);
  const messages = await messagesForThread(db, id);
  const activeTurnId = activeChatTurn(id) ?? activeBeforeRead;
  const last = messages.at(-1);
  const pendingMessageId = reviewId(messages, Boolean(activeTurnId));
  if (pendingMessageId) {
    let message = messages.find((item) => item.id === pendingMessageId);
    if (!message) {
      message = (await loadReview(db, id, pendingMessageId)) ?? undefined;
      if (message) messages.unshift(message);
    }
    if (message) {
      const pending = part<PendingPart>(message.parts, 'pending') ?? null;
      const review = await refreshLegacyReview(db, pending);
      if (review && review !== pending) {
        message.parts = message.parts.map((item) => (item === pending ? review : item));
        message.content = review.proposal.reply;
      }
    }
  }
  return {
    messages,
    activeTurnId,
    pendingMessageId,
    interruptedTurnId: !activeTurnId && last?.role === 'user' ? last.id : null
  };
}

export async function streamChat(db: Database, threadId: string, input: ChatInput, emit: Emit) {
  if (activeTurns.has(threadId))
    throw new ApiError(409, 'CHAT_BUSY', 'This thread is already processing a message.');

  const id = input.messageId ?? crypto.randomUUID();
  const controller = new AbortController();
  activeTurns.set(threadId, { id, controller });
  try {
    await runChat(db, threadId, { ...input, messageId: id }, emit, controller.signal);
  } finally {
    activeTurns.delete(threadId);
  }
}

async function runChat(
  db: Database,
  threadId: string,
  input: ChatInput & { messageId: string },
  emit: Emit,
  signal: AbortSignal
) {
  const thread = await getThread(db, threadId);
  if (!thread || thread.archivedAt)
    throw new ApiError(404, 'NOT_FOUND', 'Active thread was not found.');
  const profile = await getProfile(db);
  const history = await messagesForThread(db, threadId, recentMessageLimit);
  const currentReviewId = reviewId(history, false);
  const replyTo = input.kind === 'message' ? currentReviewId : input.replyTo;
  const prompt =
    replyTo && currentReviewId === replyTo
      ? (history.find(({ id }) => id === replyTo) ?? (await loadReview(db, threadId, replyTo)))
      : null;
  const pending = await refreshLegacyReview(
    db,
    part<PendingPart>(prompt?.parts, 'pending') ?? null
  );
  if (input.kind !== 'message' && !pending)
    throw new ApiError(
      409,
      'CHAT_CONFLICT',
      'This chat prompt has already been answered or expired.'
    );
  if (input.kind === 'clarify' && !pending?.clarification)
    throw new ApiError(409, 'CHAT_CONFLICT', 'There is no pending clarification.');
  if (input.kind === 'confirm' && pending?.clarification)
    throw new ApiError(409, 'CHAT_CONFLICT', 'Answer the clarification first.');

  const text =
    input.kind === 'message'
      ? input.text
      : input.kind === 'confirm'
        ? 'Confirm and log'
        : 'answers' in input.selection
          ? 'Confirmed meal review'
          : 'grams' in input.selection
            ? `${input.selection.grams} g`
            : (pending?.clarification?.options.find(
                ({ id }) => 'optionId' in input.selection && id === input.selection.optionId
              )?.label ?? 'Selected option');

  const user = await db.transaction(async (tx) => {
    await tx
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId))
      .for('update');
    if (input.messageId) {
      const [existing] = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(eq(chatMessages.id, input.messageId));
      if (existing)
        throw new ApiError(
          409,
          'CHAT_CONFLICT',
          'This message was already received. Refresh the thread.'
        );
    }
    if (reviewId(await messagesForThread(tx, threadId, 2), false) !== currentReviewId) {
      throw new ApiError(
        409,
        'CHAT_CONFLICT',
        'This chat prompt has already been answered or expired.'
      );
    }
    return appendMessage(tx, {
      id: input.messageId,
      threadId,
      role: 'user',
      content: text,
      parts: replyTo ? [{ type: 'turn', replyTo, kind: input.kind }] : []
    });
  });
  emit('message', { message: user });

  let resolution: TurnResolution & {
    runId?: string;
    reviewAction?: 'keep' | 'update' | 'new';
    confirmed?: number[];
  };
  try {
    signal.throwIfAborted();
    if (input.kind === 'clarify' && pending?.clarification) {
      const provider = createProvider(providerConfig(profile));
      const lookupProduct = createProductLookup(db, provider);
      resolution = await continueClarification(
        db,
        pending.proposal,
        pending.clarification,
        input.selection,
        {
          estimateThreshold: profile.estimateKcalThreshold,
          confirmed: pending.confirmed,
          previewItems: pending.items,
          replacements: input.replacements,
          signal,
          lookupProduct: (query, lookupSignal) => {
            emit('tool', { name: 'lookup_product' });
            return lookupProduct(query, lookupSignal);
          },
          lookupPortion: createPortionLookup(db, provider, {
            signal,
            onTool: (name) => emit('tool', { name })
          })
        }
      );
    } else if (input.kind === 'confirm' && pending) {
      const reuseItems = reviewedItems(pending.items, pending.proposal.items.length);
      for (const { itemIndex } of input.replacements ?? []) reuseItems.delete(itemIndex);
      resolution = await resolveForLogging(
        db,
        replaceReviewItems(pending.proposal, input.replacements ?? []),
        {
          estimateThreshold: profile.estimateKcalThreshold,
          confirmed: pending.proposal.items.map((_item, index) => index),
          reuseItems,
          lookupPortion: createPortionLookup(db, createProvider(providerConfig(profile)), {
            signal,
            onTool: (name) => emit('tool', { name })
          })
        }
      );
    } else {
      const config = providerConfig(profile);
      const sections = mealSections(text);
      if (sections.length > maxMealGroups) {
        throw new AgentError('INVALID_PROPOSAL', 'Log up to eight meals in one message.');
      }
      const options = {
        threadId,
        logDate: thread.date ?? undefined,
        provider: config.provider === 'fake' ? fixtureProvider : createProvider(config),
        summary: thread.summary,
        signal,
        onTool: (name: string) => emit('tool', { name })
      };
      if (sections.length === 1) {
        const [section] = sections;
        resolution = await runAgent(db, {
          ...options,
          text: section!.text,
          mealHeading: section!.title,
          history: history.map(({ role, content }) => ({ role, content })),
          pendingReview: pending ?? undefined,
          onText: (delta) => emit('text', { delta })
        });
        if (resolution.reviewAction !== 'keep' && !resolution.proposal.meals) {
          resolution.proposal.meal = section!.meal ?? resolution.proposal.meal;
          resolution.proposal.title =
            section!.title ?? generatedMealTitle(resolution.proposal.title);
        }
      } else {
        const resolved = [];
        for (const section of sections) {
          const resolution = await runAgent(db, {
            ...options,
            text: section.text,
            mealHeading: section.title
          });
          resolved.push({ section, resolution });
        }
        resolution = {
          ...combineMealSections(resolved),
          runId: resolved.at(-1)?.resolution.runId,
          reviewAction: 'new'
        };
      }
    }
    signal.throwIfAborted();
    const { items, proposal, clarification, reviewAction } = resolution;
    const willCommit =
      reviewAction !== 'keep' &&
      !clarification &&
      items.length > 0 &&
      (profile.autoCommit || input.kind === 'confirm');
    const mealCount = proposal.meals?.length ?? 1;
    const assistantText =
      willCommit && mealCount > 1
        ? `${mealCount} meals logged.`
        : input.kind === 'message'
          ? proposal.reply
          : willCommit
            ? 'Meal logged.'
            : clarification
              ? 'Some items still need review before this meal can be logged.'
              : 'The meal is ready to log. Confirm below.';
    const rawText = reviewAction === 'new' ? text : (pending?.rawText ?? text);
    if (reviewAction !== 'keep') {
      emit('proposal', {
        reply: assistantText,
        title: proposal.title,
        items,
        requiresConfirmation: !willCommit && !clarification
      });
    }

    const { assistant, entries } = await db.transaction(async (tx) => {
      await tx
        .select({ id: chatThreads.id })
        .from(chatThreads)
        .where(eq(chatThreads.id, threadId))
        .for('update');
      signal.throwIfAborted();
      const existing = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.threadId, threadId),
            sql`${chatMessages.parts} @> ${JSON.stringify([{ type: 'reply', userMessageId: user.id }])}::jsonb`
          )
        );
      if (existing.length)
        throw new ApiError(409, 'CHAT_CONFLICT', 'This message has already received a reply.');
      const entries = [];
      if (willCommit) {
        const now = new Date();
        for (const meal of mealsToCommit(proposal, items, rawText)) {
          let loggedAt = meal.loggedAt ? new Date(meal.loggedAt) : now;
          if (thread.date && localDate(loggedAt, profile.timezone) !== thread.date) {
            loggedAt = await localEntryTime(tx, thread.date);
          }
          const fallback = meal.meal && meal.meal !== 'other' ? mealLabels[meal.meal] : undefined;
          const entry = await commitEntry(tx, {
            items: meal.items,
            rawText: meal.rawText,
            title: generatedMealTitle(meal.title) ?? mealTitle(meal.items, fallback),
            sourceMessageId: user.id,
            meal: meal.meal,
            loggedAt
          });
          if (entry) entries.push(entry);
        }
      }
      const parts: unknown[] = [{ type: 'reply', userMessageId: user.id }];
      if (entries.length) parts.push(...entries.map(({ id }) => ({ type: 'entry', entryId: id })));
      else if (reviewAction === 'keep') parts.push({ type: 'review', id: replyTo });
      else if (clarification || items.length) {
        const state: PendingPart = {
          type: 'pending',
          rawText,
          proposal: proposalSchema.parse({ ...proposal, reply: assistantText }),
          clarification,
          confirmed: resolution.confirmed ?? [],
          items
        };
        parts.push(state);
      }
      const assistant = await appendMessage(tx, {
        threadId,
        role: 'assistant',
        content: assistantText,
        parts,
        agentRunId: resolution.runId
      });
      signal.throwIfAborted();
      return { assistant, entries };
    });
    emit('message', { message: assistant });
    if (reviewAction === 'keep') {
      if (clarification) emit('clarification', { messageId: replyTo, clarification });
      else emit('draft', { messageId: replyTo });
    } else if (clarification) emit('clarification', { messageId: assistant.id, clarification });
    else if (entries.length) {
      for (const entry of entries) emit('committed', { entry });
    } else emit('draft', { messageId: assistant.id });
    emit('done', { threadId });
  } catch (error) {
    const stopped = signal.aborted;
    const { code, message } = stopped
      ? { code: 'CHAT_STOPPED', message: 'Stopped processing this message.' }
      : errorDetails(error);
    const failure = await db.transaction((tx) =>
      appendMessage(tx, {
        threadId,
        role: 'assistant',
        content: message,
        parts: [
          { type: 'error', code },
          { type: 'reply', userMessageId: user.id }
        ]
      })
    );
    emit('message', { message: failure });
    if (stopped) {
      emit('done', { threadId });
      return;
    }
    throw error;
  }
}
