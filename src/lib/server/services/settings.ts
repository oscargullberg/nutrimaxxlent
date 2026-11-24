import { and, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import { CodexOAuthProvider, defaultCodexModel } from '../agent/codex.ts';
import { FakeProvider } from '../agent/fake.ts';
import type { Database } from '../db/client.ts';
import { goals, profiles } from '../db/schema.ts';
import { readServerEnv } from '../env.ts';
import { localDate } from '../nutrition/snapshots.ts';
import { getProfile } from './totals.ts';

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validLocale(value: string) {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

const target = z.number().nonnegative().nullable().optional();
const targets = z.object({
  kcal: target,
  proteinG: target,
  fatG: target,
  carbsG: target,
  fiberG: target
});

export const settingsInput = z.object({
  timezone: z.string().max(80).refine(validTimezone, 'Use a valid timezone.').optional(),
  locale: z.string().max(35).refine(validLocale, 'Use a valid locale.').optional(),
  autoCommit: z.boolean().optional(),
  estimateKcalThreshold: z.number().nonnegative().max(10000).optional(),
  provider: z.enum(['codex', 'fake']).nullable().optional(),
  model: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-zA-Z0-9._-]*$/u)
    .nullable()
    .optional(),
  goals: targets.optional()
});

type SettingsDb = Pick<Database, 'select' | 'transaction'>;

export function providerConfig(
  profile: Pick<typeof profiles.$inferSelect, 'provider' | 'model'>,
  env = readServerEnv()
) {
  const provider = profile.provider ?? env.provider;
  return {
    provider,
    model: provider === 'fake' ? 'fixture' : profile.model || env.model || defaultCodexModel
  };
}

export function createProvider(settings: ReturnType<typeof providerConfig>) {
  return settings.provider === 'codex'
    ? new CodexOAuthProvider(settings.model)
    : new FakeProvider();
}

async function goalsForDate(db: Pick<Database, 'select'>, date: string) {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.profileId, 1), lte(goals.effectiveFrom, date)))
    .orderBy(desc(goals.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export async function readSettings(db: Pick<Database, 'select'>, now = new Date()) {
  const profile = await getProfile(db);
  const date = localDate(now, profile.timezone);
  return { profile, today: date, goals: await goalsForDate(db, date) };
}

export async function updateSettings(
  db: SettingsDb,
  input: z.input<typeof settingsInput>,
  now = new Date()
) {
  const { goals: targets, ...fields } = settingsInput.parse(input);
  return db.transaction(async (tx) => {
    await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, 1)).for('update');
    if (Object.keys(fields).length) {
      await tx
        .update(profiles)
        .set({
          ...fields,
          locale:
            fields.locale === undefined ? undefined : Intl.getCanonicalLocales(fields.locale)[0],
          model: fields.model === undefined ? undefined : fields.model || null
        })
        .where(eq(profiles.id, 1));
    }
    const profile = await getProfile(tx);
    if (targets) {
      const date = localDate(now, profile.timezone);
      const previous = await goalsForDate(tx, date);
      const values = {
        profileId: 1,
        effectiveFrom: date,
        kcal: targets.kcal === undefined ? (previous?.kcal ?? null) : targets.kcal,
        proteinG: targets.proteinG === undefined ? (previous?.proteinG ?? null) : targets.proteinG,
        fatG: targets.fatG === undefined ? (previous?.fatG ?? null) : targets.fatG,
        carbsG: targets.carbsG === undefined ? (previous?.carbsG ?? null) : targets.carbsG,
        fiberG: targets.fiberG === undefined ? (previous?.fiberG ?? null) : targets.fiberG
      };
      await tx
        .insert(goals)
        .values(values)
        .onConflictDoUpdate({ target: [goals.profileId, goals.effectiveFrom], set: values });
    }
    return readSettings(tx, now);
  });
}
