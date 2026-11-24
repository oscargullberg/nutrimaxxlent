import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import { chatMessages, chatThreads } from '../../src/lib/server/db/schema';
import {
  appendMessage,
  createThread,
  getThread,
  listThreads,
  messagesForThread,
  updateThread
} from '../../src/lib/server/services/threads';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'persists messages, summarizes older turns and hides archived threads by default',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    let threadId: string | undefined;
    try {
      const thread = await createThread(db);
      threadId = thread.id;
      for (let i = 0; i < 12; i++) {
        await db.transaction((tx) =>
          appendMessage(tx, {
            threadId: thread.id,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Fixture message ${i}`,
            createdAt: new Date(1_700_000_000_000 + i * 1000)
          })
        );
      }
      expect(await messagesForThread(db, threadId)).toHaveLength(12);
      expect(await getThread(db, threadId)).toMatchObject({
        title: 'Fixture message 0',
        summary: expect.stringContaining('Fixture message 3'),
        summaryUpdatedAt: expect.any(Date)
      });
      expect((await getThread(db, threadId))?.summary).not.toContain('Fixture message 4');
      await updateThread(db, threadId, { archived: true });
      expect((await listThreads(db)).map(({ id }) => id)).not.toContain(threadId);
      expect((await listThreads(db, true)).map(({ id }) => id)).toContain(threadId);
    } finally {
      if (threadId) {
        await db.delete(chatMessages).where(eq(chatMessages.threadId, threadId));
        await db.delete(chatThreads).where(eq(chatThreads.id, threadId));
      }
      await close();
    }
  }
);
