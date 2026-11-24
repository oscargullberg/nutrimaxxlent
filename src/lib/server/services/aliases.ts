import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { foodAliases } from '../db/schema.ts';
import { normalizeSearch } from '../importers/source.ts';

export async function learnFoodAlias(
  db: Database,
  phrase: string,
  foodId: string,
  language = 'und'
) {
  const alias = normalizeSearch(phrase);
  if (!alias || alias.length > 200) throw new Error('An alias must contain 1 to 200 characters.');
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'learned-alias:' + alias}))`);
    await tx
      .delete(foodAliases)
      .where(and(eq(foodAliases.alias, alias), eq(foodAliases.source, 'learned')));
    await tx.insert(foodAliases).values({ alias, foodId, language, source: 'learned' });
  });
}
