import type { Database } from 'better-sqlite3';

export interface FtsHit {
  docId: number;
  score: number;
  snippet: string;
}

export type FtsStrategy = 'fts' | 'like' | 'none';

export interface FtsResult {
  strategy: FtsStrategy;
  hits: FtsHit[];
}

const MIN_TRIGRAM_CHARS = 3;

function escapeFtsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

function likePattern(query: string): string {
  const escaped = query.replace(/[%_\\]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

export function searchFts(sqlite: Database, query: string, limit = 50): FtsResult {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { strategy: 'none', hits: [] };

  if (trimmed.length >= MIN_TRIGRAM_CHARS) {
    try {
      const rows = sqlite
        .prepare(
          `SELECT rowid AS docId, bm25(fts_media, 10.0, 6.0, 3.0, 5.0, 2.0, 1.0) AS score,
                  snippet(fts_media, 2, '', '', '…', 12) AS snippet
           FROM fts_media WHERE fts_media MATCH ? ORDER BY score LIMIT ?`,
        )
        .all(escapeFtsPhrase(trimmed), limit) as FtsHit[];
      return { strategy: 'fts', hits: rows };
    } catch {
      // 查询语法异常时退化到 LIKE
    }
  }

  const rows = sqlite
    .prepare(
      `SELECT doc_id AS docId, 0 AS score,
              substr(coalesce(title, '') || ' ' || coalesce(caption, '') || ' ' || coalesce(tags, ''), 1, 120) AS snippet
       FROM media_search_doc
       WHERE title LIKE @p ESCAPE '\\' OR filename LIKE @p ESCAPE '\\' OR caption LIKE @p ESCAPE '\\'
          OR tags LIKE @p ESCAPE '\\' OR summary LIKE @p ESCAPE '\\' OR extra LIKE @p ESCAPE '\\'
       LIMIT @limit`,
    )
    .all({ p: likePattern(trimmed), limit }) as FtsHit[];

  return { strategy: 'like', hits: rows };
}
