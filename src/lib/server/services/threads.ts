import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from '../db/client.ts';
import { agentRuns, chatMessages, chatThreads, logEntries } from '../db/schema.ts';

export const recentMessageLimit = 8;
const summaryBatch = 4;
const summaryLimit = 2400;
const messageOrder = [desc(chatMessages.createdAt), desc(chatMessages.id)] as const;
type Reader = Pick<Database, 'select'>;

export async function createThread(db: Pick<Database, 'insert'>, title = 'New chat') {
  const [thread] = await db
    .insert(chatThreads)
    .values({ title: title.trim() || 'New chat' })
    .returning();
  if (!thread) throw new Error('Could not create thread.');
  return thread;
}

export async function getOrCreateDailyThread(db: Database, date: string) {
  const [thread] = await db
    .insert(chatThreads)
    .values({ title: 'Daily log', date })
    .onConflictDoNothing({ target: chatThreads.date })
    .returning();
  if (thread) return thread;
  const [existing] = await listThreads(db, true, date);
  if (!existing) throw new Error('Could not find the daily thread.');
  return existing;
}

export async function listThreads(db: Reader, includeArchived = false, date?: string) {
  return db
    .select()
    .from(chatThreads)
    .where(
      and(
        date ? eq(chatThreads.date, date) : isNull(chatThreads.date),
        includeArchived ? undefined : isNull(chatThreads.archivedAt)
      )
    )
    .orderBy(desc(chatThreads.updatedAt))
    .limit(100);
}

export async function getThread(db: Reader, id: string) {
  const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
  return thread ?? null;
}

export async function updateThread(
  db: Database,
  id: string,
  input: { title?: string; archived?: boolean }
) {
  const [thread] = await db
    .update(chatThreads)
    .set({
      title: input.title?.trim(),
      archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null,
      updatedAt: new Date()
    })
    .where(eq(chatThreads.id, id))
    .returning();
  return thread ?? null;
}

export async function deleteThread(db: Database, id: string) {
  return db.transaction(async (tx) => {
    const [thread] = await tx
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, id))
      .for('update');
    if (!thread) return null;

    const messages = eq(chatMessages.threadId, id);
    await tx
      .update(logEntries)
      .set({ sourceMessageId: null })
      .where(
        inArray(
          logEntries.sourceMessageId,
          tx.select({ id: chatMessages.id }).from(chatMessages).where(messages)
        )
      );
    await tx.delete(chatMessages).where(messages);
    await tx.delete(agentRuns).where(eq(agentRuns.threadId, id));
    await tx.delete(chatThreads).where(eq(chatThreads.id, id));
    return thread;
  });
}

export async function messagesForThread(db: Reader, threadId: string, limit = 100) {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(...messageOrder)
    .limit(limit);
  return rows.reverse();
}

export async function appendMessage(
  tx: DatabaseTransaction,
  message: typeof chatMessages.$inferInsert
) {
  const [thread] = await tx
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.id, message.threadId))
    .for('update');
  if (!thread || thread.archivedAt) throw new Error('Active chat thread was not found.');
  const [saved] = await tx.insert(chatMessages).values(message).returning();
  if (!saved) throw new Error('Could not save message.');
  const [total] = await tx
    .select({ amount: count() })
    .from(chatMessages)
    .where(eq(chatMessages.threadId, message.threadId));
  const size = total?.amount ?? 0;
  let summary: string | undefined;
  if (size > recentMessageLimit && (size - recentMessageLimit) % summaryBatch === 0) {
    const rows = await tx
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id))
      .orderBy(...messageOrder)
      .offset(recentMessageLimit)
      .limit(summaryBatch);
    const excerpts = rows
      .reverse()
      .map(({ role, content }) => `${role}: ${content.replace(/\s+/gu, ' ').slice(0, 240)}`);
    summary = [thread.summary, ...excerpts].filter(Boolean).join('\n').slice(-summaryLimit);
  }

  await tx
    .update(chatThreads)
    .set({
      title:
        thread.title === 'New chat' && message.role === 'user'
          ? message.content.trim().replace(/\s+/gu, ' ').slice(0, 70) || thread.title
          : undefined,
      summary,
      summaryUpdatedAt: summary ? new Date() : undefined,
      updatedAt: new Date()
    })
    .where(eq(chatThreads.id, thread.id));
  return saved;
}
