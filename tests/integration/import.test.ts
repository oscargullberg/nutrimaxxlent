import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import { datasetRuns, foodSources, foods } from '../../src/lib/server/db/schema';
import { runImport, type FoodSourceAdapter } from '../../src/lib/server/importers/source';

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)('imports a version once and rolls back a failed refresh', async () => {
  const { db, close } = connectDatabase(databaseUrl!);
  const id = `fixture-${randomUUID()}`;
  const adapter: FoodSourceAdapter = {
    source: {
      id,
      name: 'Fixture',
      license: 'CC0',
      attribution: 'Fixture',
      homepage: 'https://example.test'
    },
    version: 'fixture-1',
    async *records() {
      await Promise.resolve();
      yield { id: 'one', name: 'Fixture food', kind: 'generic', nutrients: [] };
    }
  };

  try {
    expect(await runImport(db, adapter)).toMatchObject({ inserted: 1, updated: 0 });
    expect(await runImport(db, adapter)).toMatchObject({ inserted: 0, unchanged: 1 });
    await expect(
      runImport(db, {
        ...adapter,
        version: 'fixture-2',
        async *records() {
          await Promise.resolve();
          yield { id: 'one', name: 'Changed food', kind: 'generic', nutrients: [] };
          throw new Error('Fixture failed');
        }
      })
    ).rejects.toThrow('Fixture failed');

    expect(await db.select().from(foods).where(eq(foods.sourceId, id))).toMatchObject([
      { sourceFoodId: 'one', name: 'Fixture food', sourceVersion: 'fixture-1' }
    ]);
    expect(await db.select().from(datasetRuns).where(eq(datasetRuns.sourceId, id))).toHaveLength(3);
    const [source] = await db.select().from(foodSources).where(eq(foodSources.id, id));
    expect(source?.version).toBe('fixture-1');
  } finally {
    await db.delete(foods).where(eq(foods.sourceId, id));
    await db.delete(datasetRuns).where(eq(datasetRuns.sourceId, id));
    await db.delete(foodSources).where(eq(foodSources.id, id));
    await close();
  }
});
