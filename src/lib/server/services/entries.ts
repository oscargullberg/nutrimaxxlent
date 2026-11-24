import { and, desc, eq, exists, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveItem, type ResolvedItem } from '../agent/resolve.ts';
import {
  catalogSelection,
  mealTitleSchema,
  proposalSchema,
  selectedCatalogItem,
  validateProposal
} from '../agent/proposal.ts';
import { databaseProposalCatalog } from '../agent/resolve.ts';
import type { Database, DatabaseTransaction } from '../db/client.ts';
import {
  chatMessages,
  foods,
  logEntries,
  logEntryItems,
  logEntryRevisions,
  logItemNutrients,
  meal
} from '../db/schema.ts';
import { ApiError } from '../http/api.ts';
import { canonicalNutrients } from '../../nutrition-reference.ts';
import { scaleDietary } from '../nutrition/dietary.ts';
import { createNutrientSnapshots } from '../nutrition/snapshots.ts';
import { getProfile, localDay } from './totals.ts';

const meals = z.enum(meal.enumValues);
const timestamp = z.iso.datetime({ offset: true });
const nutrientIds = z.enum(canonicalNutrients.map(({ id }) => id));

export const entryEdit = z.object({
  title: mealTitleSchema.optional(),
  meal: meals.optional(),
  loggedAt: timestamp.optional(),
  date: z.iso.date().optional()
});
export const entrySplit = z.object({
  groups: z
    .array(
      z.object({
        title: mealTitleSchema,
        meal: meals,
        itemIds: z.array(z.uuid()).min(1).max(64)
      })
    )
    .min(2)
    .max(8)
});
const portionEdit = z
  .strictObject({
    quantity: z.number().positive().optional(),
    unit: z.string().trim().min(1).max(80).optional(),
    grams: z.number().positive().optional(),
    per100g: z.partialRecord(nutrientIds, z.number().nonnegative()).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide an item change.');
export const itemEdit = z.union([z.strictObject({ replacement: catalogSelection }), portionEdit]);

export const manualEntryInput = z.object({
  rawText: z.string().trim().min(1).max(3000).optional(),
  title: mealTitleSchema.optional(),
  meal: meals.default('other'),
  loggedAt: timestamp.optional(),
  date: z.iso.date().optional(),
  items: z.array(proposalSchema.shape.items.element).min(1).max(16)
});

type Reader = Pick<Database, 'select'>;
type Entry = typeof logEntries.$inferSelect;
type Item = typeof logEntryItems.$inferSelect;

export async function localEntryTime(db: DatabaseTransaction, date: string) {
  const profile = await getProfile(db);
  const [row] = await db.execute<{ value: string }>(sql`
    SELECT ((${date}::date + time '12:00') AT TIME ZONE ${profile.timezone})::text AS value
  `);
  if (!row) throw new Error('Could not interpret the selected date.');
  return new Date(row.value);
}

export async function entryDetails(db: Reader, entries: readonly Entry[]) {
  if (!entries.length) return [];
  const rows = await db
    .select({ ...getTableColumns(logEntryItems), nameEn: foods.nameEn })
    .from(logEntryItems)
    .leftJoin(foods, eq(logEntryItems.foodId, foods.id))
    .where(
      and(
        inArray(
          logEntryItems.entryId,
          entries.map(({ id }) => id)
        ),
        isNull(logEntryItems.removedAt)
      )
    )
    .orderBy(logEntryItems.id);
  const nutrients = rows.length
    ? await db
        .select()
        .from(logItemNutrients)
        .where(
          inArray(
            logItemNutrients.itemId,
            rows.map(({ id }) => id)
          )
        )
    : [];
  const byEntry = Map.groupBy(rows, ({ entryId }) => entryId);
  const byItem = Map.groupBy(nutrients, ({ itemId }) => itemId);
  return entries.map((entry) => ({
    ...entry,
    items: (byEntry.get(entry.id) ?? []).map((item) => ({
      ...item,
      nutrients: Object.fromEntries(
        (byItem.get(item.id) ?? []).map(({ nutrientId, amount }) => [nutrientId, amount])
      ),
      estimatedNutrients: (byItem.get(item.id) ?? [])
        .filter(({ isEstimate, amount }) => isEstimate && amount !== null)
        .map(({ nutrientId }) => nutrientId)
    }))
  }));
}

export async function getEntry(db: Reader, id: string) {
  const matching = await db.select().from(logEntries).where(eq(logEntries.id, id));
  return (await entryDetails(db, matching))[0] ?? null;
}

export async function listEntries(db: Database, date?: string) {
  const profile = await getProfile(db);
  const activeItems = db
    .select({ id: logEntryItems.id })
    .from(logEntryItems)
    .where(and(eq(logEntryItems.entryId, logEntries.id), isNull(logEntryItems.removedAt)));
  const matching = db
    .select()
    .from(logEntries)
    .where(
      and(
        eq(logEntries.profileId, profile.id),
        eq(logEntries.status, 'active'),
        exists(activeItems),
        date ? localDay(date, profile.timezone) : undefined
      )
    )
    .orderBy(desc(logEntries.loggedAt), desc(logEntries.id));
  return entryDetails(db, await (date ? matching : matching.limit(100)));
}

function itemValues(item: ResolvedItem) {
  return {
    kind: item.kind,
    foodId: item.foodId ?? null,
    recipeId: item.recipeId ?? null,
    label: item.label,
    quantity: item.quantity,
    unit: item.unit,
    grams: item.grams,
    provenance: item.provenance,
    confidence: item.confidence,
    assumptions: item.assumptions,
    resolution: item.resolution,
    dietary: item.dietary
  };
}

async function saveSnapshots(tx: DatabaseTransaction, itemId: string, item: ResolvedItem) {
  const snapshots = createNutrientSnapshots(
    item.nutrients,
    item.provenance === 'estimate',
    item.estimatedNutrients
  );
  if (snapshots.length)
    await tx.insert(logItemNutrients).values(snapshots.map((row) => ({ ...row, itemId })));
}

export async function commitEntry(
  tx: DatabaseTransaction,
  input: {
    items: ResolvedItem[];
    rawText: string;
    title?: string;
    meal?: Entry['meal'];
    loggedAt?: Date;
    sourceMessageId?: string;
  }
) {
  if (!input.items.length) throw new Error('At least one food item is required.');
  const [entry] = await tx
    .insert(logEntries)
    .values({
      rawText: input.rawText,
      title: input.title,
      meal: input.meal,
      loggedAt: input.loggedAt ?? new Date(),
      sourceMessageId: input.sourceMessageId,
      confidence: Math.min(...input.items.map((item) => item.confidence))
    })
    .returning();
  if (!entry) throw new Error('Could not save the log entry.');

  // Insert each item alongside its own snapshot within the same transaction.
  for (const item of input.items) {
    const [row] = await tx
      .insert(logEntryItems)
      .values({ ...itemValues(item), entryId: entry.id })
      .returning({ id: logEntryItems.id });
    if (!row) throw new Error('Could not save the log item.');
    await saveSnapshots(tx, row.id, item);
  }
  return getEntry(tx, entry.id);
}

export async function addManualEntry(db: Database, input: z.input<typeof manualEntryInput>) {
  const fields = manualEntryInput.parse(input);
  return db.transaction(async (tx) => {
    const proposal = await validateProposal(
      {
        reply: 'Manual entry',
        needsClarification: false,
        items: fields.items
      },
      databaseProposalCatalog(tx)
    );
    const items = await Promise.all(
      proposal.items.map((item) => {
        if (item.kind === 'clarify')
          throw new ApiError(400, 'INVALID_INPUT', 'Select a food or recipe before logging.');
        return resolveItem(tx, item);
      })
    );
    return commitEntry(tx, {
      items,
      rawText: fields.rawText ?? items.map(({ label }) => label).join(', '),
      title: fields.title,
      loggedAt: fields.loggedAt
        ? new Date(fields.loggedAt)
        : fields.date
          ? await localEntryTime(tx, fields.date)
          : undefined,
      meal: fields.meal
    });
  });
}

async function lockActiveEntry(tx: DatabaseTransaction, id: string) {
  const [entry] = await tx.select().from(logEntries).where(eq(logEntries.id, id)).for('update');
  return entry?.status === 'active' ? entry : null;
}

async function recordChange(
  tx: DatabaseTransaction,
  entryId: string,
  action: string,
  previous: Record<string, unknown>
) {
  await tx.insert(logEntryRevisions).values({ entryId, action, previous });
}

export async function backfillCatalogDietary(db: Database, sourceId: string) {
  return db.transaction(async (tx) => {
    const eligible = and(
      eq(foods.sourceId, sourceId),
      eq(logEntryItems.provenance, 'catalog'),
      isNull(logEntryItems.removedAt),
      or(
        eq(logEntryItems.kind, 'food'),
        and(
          eq(logEntryItems.kind, 'dish_adjustment'),
          sql`${logEntryItems.resolution}->'adjustments' = '[]'::jsonb`
        )
      ),
      or(
        sql`coalesce(${logEntryItems.dietary}->'groups', '{}'::jsonb) = '{}'::jsonb
          and ${foods.classification}->'dietary'->'groups' <> '{}'::jsonb`,
        sql`coalesce(${logEntryItems.dietary}->'novaGrams', '{}'::jsonb) = '{}'::jsonb
          and ${foods.classification}->'dietary'->'novaGrams' <> '{}'::jsonb`
      )
    );
    // Use the same entry lock as log edits and status changes.
    const entries = await tx
      .select({ id: logEntries.id })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.status, 'active'),
          exists(
            tx
              .select({ id: logEntryItems.id })
              .from(logEntryItems)
              .innerJoin(foods, eq(logEntryItems.foodId, foods.id))
              .where(and(eq(logEntryItems.entryId, logEntries.id), eligible))
          )
        )
      )
      .orderBy(logEntries.id)
      .for('update');

    let count = 0;
    for (const { id: entryId } of entries) {
      const rows = await tx
        .select({
          item: logEntryItems,
          classification: foods.classification,
          sourceVersion: foods.sourceVersion
        })
        .from(logEntryItems)
        .innerJoin(foods, eq(logEntryItems.foodId, foods.id))
        .where(and(eq(logEntryItems.entryId, entryId), eligible));
      for (const { item, classification, sourceVersion } of rows) {
        if (!classification?.dietary) continue;
        const dietary = scaleDietary(classification.dietary, item.grams / 100);
        if (item.dietary && Object.keys(item.dietary.groups).length) {
          dietary.groups = item.dietary.groups;
        }
        if (item.dietary && Object.keys(item.dietary.novaGrams).length) {
          dietary.novaGrams = item.dietary.novaGrams;
          dietary.unknownNovaG = item.dietary.unknownNovaG;
          dietary.novaSources = item.dietary.novaSources;
        }
        await recordChange(tx, entryId, 'backfill_dietary', {
          itemId: item.id,
          dietary: item.dietary,
          sourceVersion
        });
        await tx.update(logEntryItems).set({ dietary }).where(eq(logEntryItems.id, item.id));
        count++;
      }
    }
    return count;
  });
}

export async function updateEntry(db: Database, id: string, input: z.input<typeof entryEdit>) {
  const fields = entryEdit.parse(input);
  return db.transaction(async (tx) => {
    const entry = await lockActiveEntry(tx, id);
    if (!entry) return null;
    await recordChange(tx, id, 'edit_entry', entry);
    await tx
      .update(logEntries)
      .set({
        loggedAt: fields.loggedAt
          ? new Date(fields.loggedAt)
          : fields.date
            ? await localEntryTime(tx, fields.date)
            : undefined,
        title: fields.title,
        meal: fields.meal,
        updatedAt: new Date()
      })
      .where(eq(logEntries.id, id));
    return getEntry(tx, id);
  });
}

export async function splitEntry(
  db: Database,
  id: string,
  { groups }: z.output<typeof entrySplit>
) {
  return db.transaction(async (tx) => {
    const entry = await lockActiveEntry(tx, id);
    if (!entry) return null;
    const items = await tx
      .select({ id: logEntryItems.id, confidence: logEntryItems.confidence })
      .from(logEntryItems)
      .where(and(eq(logEntryItems.entryId, id), isNull(logEntryItems.removedAt)));
    const confidenceById = new Map(items.map((item) => [item.id, item.confidence]));
    const itemIds = groups.flatMap((group) => group.itemIds);
    if (
      itemIds.length !== items.length ||
      new Set(itemIds).size !== items.length ||
      itemIds.some((itemId) => !confidenceById.has(itemId))
    ) {
      throw new ApiError(409, 'ENTRY_CHANGED', 'Assign each current food to exactly one meal.');
    }
    await recordChange(tx, id, 'split_entry', { ...entry, groups });
    const newIds = [];
    for (const [index, group] of groups.entries()) {
      const confidence = Math.min(...group.itemIds.map((itemId) => confidenceById.get(itemId)!));
      const fields = { title: group.title, meal: group.meal, confidence };
      if (index === 0) {
        await tx
          .update(logEntries)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(logEntries.id, id));
        continue;
      }
      const [created] = await tx
        .insert(logEntries)
        .values({
          ...fields,
          profileId: entry.profileId,
          loggedAt: entry.loggedAt,
          rawText: entry.rawText,
          sourceMessageId: entry.sourceMessageId
        })
        .returning({ id: logEntries.id });
      if (!created) throw new Error('Could not save the split meal.');
      await tx
        .update(logEntryItems)
        .set({ entryId: created.id })
        .where(inArray(logEntryItems.id, group.itemIds));
      newIds.push(created.id);
    }
    const originalLink = JSON.stringify([{ type: 'entry', entryId: id }]);
    const newLinks = JSON.stringify(newIds.map((entryId) => ({ type: 'entry', entryId })));
    await tx
      .update(chatMessages)
      .set({ parts: sql`${chatMessages.parts} || ${newLinks}::jsonb` })
      .where(sql`${chatMessages.parts} @> ${originalLink}::jsonb`);
    return getEntry(tx, id);
  });
}

async function getActiveItem(tx: DatabaseTransaction, entryId: string, itemId: string) {
  const entry = await lockActiveEntry(tx, entryId);
  if (!entry) return null;
  const [item] = await tx
    .select()
    .from(logEntryItems)
    .where(
      and(
        eq(logEntryItems.id, itemId),
        eq(logEntryItems.entryId, entryId),
        isNull(logEntryItems.removedAt)
      )
    );
  return item ?? null;
}

function changedResolution(item: Item, edit: z.output<typeof portionEdit>) {
  const resolution = item.resolution as ResolvedItem['resolution'];
  if (resolution.kind === 'food') {
    return {
      ...resolution,
      quantity: edit.grams ?? edit.quantity ?? item.quantity,
      unit: edit.grams ? 'g' : (edit.unit ?? item.unit)
    };
  }
  if (resolution.kind === 'recipe') {
    return {
      ...resolution,
      servings: edit.grams
        ? (resolution.servings * edit.grams) / item.grams
        : (edit.quantity ?? resolution.servings)
    };
  }
  if (resolution.kind === 'estimate') {
    return {
      ...resolution,
      grams: edit.grams ?? edit.quantity ?? resolution.grams,
      per100g: edit.per100g ?? resolution.per100g
    };
  }
  return { ...resolution, grams: edit.grams ?? edit.quantity ?? resolution.grams };
}

export async function editLogItem(
  db: Database,
  entryId: string,
  itemId: string,
  input: z.input<typeof itemEdit>
) {
  const fields = itemEdit.parse(input);
  return db.transaction(async (tx) => {
    const item = await getActiveItem(tx, entryId, itemId);
    if (!item) return null;
    const replacing = 'replacement' in fields;
    const resolution = replacing
      ? selectedCatalogItem(fields.replacement)
      : changedResolution(item, fields);
    await validateProposal(
      { reply: 'Edit', needsClarification: false, items: [resolution] },
      databaseProposalCatalog(tx)
    );
    const resolved = await resolveItem(tx, resolution);
    if (
      !replacing &&
      ((fields.per100g && resolved.kind === 'estimate') || item.provenance === 'corrected')
    ) {
      resolved.provenance = 'corrected';
    }
    const snapshots = await tx
      .select()
      .from(logItemNutrients)
      .where(eq(logItemNutrients.itemId, itemId));
    await recordChange(tx, entryId, replacing ? 'replace_item' : 'edit_item', { item, snapshots });
    await tx.update(logEntryItems).set(itemValues(resolved)).where(eq(logEntryItems.id, itemId));
    await tx.delete(logItemNutrients).where(eq(logItemNutrients.itemId, itemId));
    await saveSnapshots(tx, itemId, resolved);
    await tx.update(logEntries).set({ updatedAt: new Date() }).where(eq(logEntries.id, entryId));
    return getEntry(tx, entryId);
  });
}

export async function removeLogItem(db: Database, entryId: string, itemId: string) {
  return db.transaction(async (tx) => {
    const item = await getActiveItem(tx, entryId, itemId);
    if (!item) return null;
    await recordChange(tx, entryId, 'remove_item', item);
    const now = new Date();
    await tx.update(logEntryItems).set({ removedAt: now }).where(eq(logEntryItems.id, itemId));
    const [remaining] = await tx
      .select({ id: logEntryItems.id })
      .from(logEntryItems)
      .where(and(eq(logEntryItems.entryId, entryId), isNull(logEntryItems.removedAt)))
      .limit(1);
    await tx
      .update(logEntries)
      .set({ status: remaining ? undefined : 'deleted', updatedAt: now })
      .where(eq(logEntries.id, entryId));
    return getEntry(tx, entryId);
  });
}

export async function changeEntryStatus(db: Database, id: string, status: 'undone' | 'deleted') {
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(logEntries).where(eq(logEntries.id, id)).for('update');
    if (!entry || entry.status === 'deleted') return null;
    if (entry.status !== status) {
      await recordChange(tx, id, status === 'undone' ? 'undo' : 'delete', entry);
      await tx
        .update(logEntries)
        .set({ status, updatedAt: new Date() })
        .where(eq(logEntries.id, id));
    }
    return getEntry(tx, id);
  });
}
