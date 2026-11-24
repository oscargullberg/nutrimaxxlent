import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { FakeProvider } from '../../src/lib/server/agent/fake';
import { finishAgentRun, promptVersion, startAgentRun } from '../../src/lib/server/agent/trace';
import { connectDatabase } from '../../src/lib/server/db/client';
import { agentRuns, chatThreads } from '../../src/lib/server/db/schema';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)('records sanitized agent metrics and the failure category', async () => {
  const { db, close } = connectDatabase(databaseUrl!);
  let threadId: string | undefined;
  const secret = 'fake-refresh-token-do-not-persist';
  try {
    const [thread] = await db
      .insert(chatThreads)
      .values({ title: 'Fixture' })
      .returning({ id: chatThreads.id });
    threadId = thread!.id;
    const run = await startAgentRun(db, threadId, new FakeProvider());
    await finishAgentRun(
      db,
      run,
      'failed',
      {
        inputTokens: 12,
        outputTokens: 7,
        toolCalls: ['get_food', secret]
      },
      'AGENT_TIMEOUT'
    );
    const [stored] = await db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
    expect(stored).toMatchObject({
      provider: 'fake',
      model: 'fixture',
      promptVersion,
      tokens: { input: 12, output: 7 },
      latencyMs: expect.any(Number),
      toolCalls: ['get_food'],
      status: 'failed',
      errorCategory: 'AGENT_TIMEOUT'
    });
    expect(JSON.stringify(stored)).not.toContain(secret);
  } finally {
    if (threadId) {
      await db.delete(agentRuns).where(eq(agentRuns.threadId, threadId));
      await db.delete(chatThreads).where(eq(chatThreads.id, threadId));
    }
    await close();
  }
});
