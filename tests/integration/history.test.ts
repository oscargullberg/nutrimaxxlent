import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import { chatMessages, chatThreads, logEntries } from '../../src/lib/server/db/schema';
import { searchHistory } from '../../src/lib/server/services/search';
import { appendMessage, createThread, updateThread } from '../../src/lib/server/services/threads';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  'searches active log entries and archived threads by message text',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const thread = await createThread(db);
    const query = `mealfixture${randomUUID().slice(0, 8)}`;
    let entryId: string | undefined;
    try {
      const message = await db.transaction((tx) =>
        appendMessage(tx, {
          threadId: thread.id,
          role: 'user',
          content: `Lunch with ${query}`
        })
      );
      const [entry] = await db
        .insert(logEntries)
        .values({
          loggedAt: new Date(),
          rawText: query,
          confidence: 1,
          sourceMessageId: message.id
        })
        .returning({ id: logEntries.id });
      entryId = entry!.id;
      await updateThread(db, thread.id, { archived: true });
      expect(await searchHistory(db, query)).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'entry', id: entryId, threadId: thread.id }),
          expect.objectContaining({ kind: 'message', id: message.id, threadId: thread.id })
        ])
      );
    } finally {
      if (entryId) await db.delete(logEntries).where(eq(logEntries.id, entryId));
      await db.delete(chatMessages).where(eq(chatMessages.threadId, thread.id));
      await db.delete(chatThreads).where(eq(chatThreads.id, thread.id));
      await close();
    }
  }
);
