import { expect, test } from 'vitest';
import { connectDatabase } from '../../src/lib/server/db/client';
import {
  readSettings,
  settingsInput,
  updateSettings
} from '../../src/lib/server/services/settings';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('validates timezone and locale values', () => {
  expect(settingsInput.safeParse({ timezone: 'Invalid/Zone' }).success).toBe(false);
  expect(settingsInput.safeParse({ locale: 'not_a_locale' }).success).toBe(false);
});

test.skipIf(!databaseUrl)(
  'updates preferences and effective goals and reads them back',
  async () => {
    const { db, close } = connectDatabase(databaseUrl!);
    const rollback = new Error('Rollback fixture');
    try {
      await expect(
        db.transaction(async (tx) => {
          const now = new Date('2038-05-12T00:01Z');
          const updated = await updateSettings(
            tx,
            {
              timezone: 'America/Chicago',
              locale: 'sv-se',
              autoCommit: false,
              provider: 'fake',
              model: 'test-fixture',
              estimateKcalThreshold: 140,
              goals: { kcal: 2000, proteinG: 85 }
            },
            now
          );
          expect(updated).toMatchObject({
            today: '2038-05-11',
            profile: {
              timezone: 'America/Chicago',
              locale: 'sv-SE',
              autoCommit: false,
              provider: 'fake',
              model: 'test-fixture',
              estimateKcalThreshold: 140
            },
            goals: { effectiveFrom: '2038-05-11', kcal: 2000, proteinG: 85 }
          });
          await updateSettings(tx, { goals: { proteinG: null } }, now);
          expect((await readSettings(tx, now)).goals).toMatchObject({ kcal: 2000, proteinG: null });
          throw rollback;
        })
      ).rejects.toBe(rollback);
    } finally {
      await close();
    }
  }
);
