import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';

export type HistoryMatch = {
  kind: 'message' | 'entry';
  id: string;
  threadId: string | null;
  title: string | null;
  text: string;
  date: string;
};

export async function searchHistory(db: Database, text: string) {
  const query = text.trim();
  if (!query) return [];
  return db.execute<HistoryMatch>(sql`
    WITH terms AS (SELECT plainto_tsquery('simple', ${query}) AS query)
    SELECT kind, id, "threadId", title, text, date
    FROM (
      SELECT 'message' AS kind, m.id, m.thread_id AS "threadId", t.title, m.content AS text,
        m.created_at::text AS date, ts_rank(to_tsvector('simple', m.content), terms.query) AS rank
      FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id CROSS JOIN terms
      WHERE to_tsvector('simple', m.content) @@ terms.query
      UNION ALL
      SELECT 'entry', e.id, m.thread_id, t.title, e.raw_text, e.logged_at::text,
        ts_rank(to_tsvector('simple', e.raw_text), terms.query)
      FROM log_entries e LEFT JOIN chat_messages m ON m.id = e.source_message_id
      LEFT JOIN chat_threads t ON t.id = m.thread_id CROSS JOIN terms
      WHERE e.status = 'active' AND to_tsvector('simple', e.raw_text) @@ terms.query
    ) matches
    ORDER BY rank DESC, date DESC, id
    LIMIT 60
  `);
}
