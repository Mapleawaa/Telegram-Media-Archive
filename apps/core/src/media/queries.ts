import type { Database } from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type {
  AnnotationItem,
  JobItem,
  JobStatus,
  MediaDetail,
  MediaListItem,
  MediaMetadataItem,
  MediaType,
  Page,
  SearchFilters,
  SourceItem,
} from '@tma/shared';
import type { AppContext } from '../context.js';
import { mediaAnnotation, mediaMetadata, telegramMessage } from '../database/schema.js';

export interface ListOptions {
  filters: SearchFilters;
  limit: number;
  cursor?: string;
  candidateIds?: number[];
  order: 'recent' | 'relevance';
}

interface ListRow {
  id: number;
  canonical_title: string | null;
  type: string;
  mime: string | null;
  size: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  ai_status: string;
  created_at: number;
  file_unique_id: string;
  quality: string | null;
  year: number | null;
  title_norm: string | null;
  file_name: string | null;
  source_count: number;
  primary_thumb: string | null;
  tags: string | null;
}

const LIST_SELECT = `
SELECT a.id, a.canonical_title, a.type, a.mime, a.size, a.duration_sec, a.width, a.height,
       a.ai_status, a.created_at, a.file_unique_id,
       m.quality, m.year, m.title_norm, m.file_name,
       (SELECT COUNT(*) FROM telegram_message tm WHERE tm.media_asset_id = a.id) AS source_count,
       (SELECT tm.thumbnail_file_id FROM telegram_message tm
         WHERE tm.media_asset_id = a.id AND tm.is_primary = 1 LIMIT 1) AS primary_thumb,
       (SELECT group_concat(DISTINCT t.tag) FROM media_tag t WHERE t.media_asset_id = a.id) AS tags
FROM media_asset a
LEFT JOIN media_metadata m ON m.media_asset_id = a.id
`;

function mapListRow(row: ListRow): MediaListItem {
  return {
    id: row.id,
    title: row.canonical_title ?? row.title_norm ?? row.file_name ?? `#${row.id}`,
    type: row.type as MediaType,
    mime: row.mime,
    sizeBytes: row.size,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    quality: row.quality,
    year: row.year,
    aiStatus: row.ai_status as MediaListItem['aiStatus'],
    sourceCount: row.source_count,
    tags: row.tags
      ? [...new Set(row.tags.split(',').map((t) => t.trim()))].filter(Boolean)
      : [],
    hasThumbnail: row.primary_thumb !== null,
    createdAt: row.created_at,
  };
}

function buildWhere(filters: SearchFilters, cursor: string | undefined): {
  sql: string;
  params: Record<string, unknown>;
} {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.type) {
    where.push('a.type = @type');
    params.type = filters.type;
  }
  if (filters.quality) {
    where.push('m.quality = @quality');
    params.quality = filters.quality;
  }
  if (filters.year !== undefined) {
    where.push('m.year = @year');
    params.year = filters.year;
  }
  if (filters.aiStatus) {
    where.push('a.ai_status = @aiStatus');
    params.aiStatus = filters.aiStatus;
  }
  if (filters.tag) {
    where.push(
      'EXISTS (SELECT 1 FROM media_tag t WHERE t.media_asset_id = a.id AND t.tag = @tag)',
    );
    params.tag = filters.tag;
  }
  if (cursor) {
    const [ts, id] = cursor.split(':');
    where.push('(a.created_at < @cts OR (a.created_at = @cts AND a.id < @cid))');
    params.cts = Number(ts);
    params.cid = Number(id);
  }

  return { sql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function queryMedia(sqlite: Database, opts: ListOptions): Page<MediaListItem> {
  const { sql, params } = buildWhere(opts.filters, opts.order === 'recent' ? opts.cursor : undefined);

  if (opts.candidateIds) {
    if (opts.candidateIds.length === 0) return { items: [], nextCursor: null };
    const placeholders = opts.candidateIds.map((_, i) => `@c${i}`).join(', ');
    opts.candidateIds.forEach((id, i) => {
      params[`c${i}`] = id;
    });
    const whereWithIds = sql ? `${sql} AND a.id IN (${placeholders})` : `WHERE a.id IN (${placeholders})`;

    const rows = sqlite
      .prepare(`${LIST_SELECT} ${whereWithIds}`)
      .all(params) as ListRow[];

    const items = rows.map(mapListRow);
    if (opts.order === 'relevance') {
      const rank = new Map(opts.candidateIds.map((id, i) => [id, i]));
      items.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
      return { items: items.slice(0, opts.limit), nextCursor: null };
    }
    items.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    return { items: items.slice(0, opts.limit), nextCursor: null };
  }

  const rows = sqlite
    .prepare(
      `${LIST_SELECT} ${sql} ORDER BY a.created_at DESC, a.id DESC LIMIT @limit`,
    )
    .all({ ...params, limit: opts.limit + 1 }) as ListRow[];

  const hasMore = rows.length > opts.limit;
  const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at}:${last.id}` : null;

  return { items: pageRows.map(mapListRow), nextCursor };
}

export function getMediaDetail(ctx: AppContext, id: number): MediaDetail | null {
  const row = ctx.sqlite
    .prepare(`${LIST_SELECT} WHERE a.id = @id`)
    .get({ id }) as ListRow | undefined;
  if (!row) return null;

  const item = mapListRow(row);
  const meta = ctx.db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, id))
    .get();
  const sources = ctx.db
    .select()
    .from(telegramMessage)
    .where(eq(telegramMessage.mediaAssetId, id))
    .all();
  const annotations = ctx.db
    .select()
    .from(mediaAnnotation)
    .where(eq(mediaAnnotation.mediaAssetId, id))
    .all();

  const jobRows = ctx.sqlite
    .prepare(
      `SELECT id, type, status, attempts, max_attempts AS maxAttempts, error, created_at AS createdAt,
              started_at AS startedAt, finished_at AS finishedAt
       FROM jobs WHERE json_extract(payload, '$.mediaId') = @id
       ORDER BY created_at DESC LIMIT 20`,
    )
    .all({ id }) as {
    id: number;
    type: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    error: string | null;
    createdAt: number;
    startedAt: number | null;
    finishedAt: number | null;
  }[];

  const metadata: MediaMetadataItem | null = meta
    ? {
        fileName: meta.fileName,
        year: meta.year,
        season: meta.season,
        episode: meta.episode,
        quality: meta.quality,
        codec: meta.codec,
        source: meta.source,
        audio: meta.audio,
        titleNorm: meta.titleNorm,
        summary: meta.summary,
        extractedBy: meta.extractedBy,
      }
    : null;

  const sourceItems: SourceItem[] = sources.map((s) => ({
    id: s.id,
    chatId: s.chatId,
    messageId: s.messageId,
    chatTitle: s.chatTitle,
    senderName: s.senderName,
    caption: s.caption,
    messageDate: s.messageDate.getTime(),
    via: s.via,
    isPrimary: s.isPrimary,
  }));

  const annotationItems: AnnotationItem[] = annotations.map((a) => ({
    id: a.id,
    rawText: a.rawText,
    createdAt: a.createdAt.getTime(),
  }));

  const jobItems: JobItem[] = jobRows.map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status as JobStatus,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    error: j.error,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  }));

  return {
    ...item,
    fileUniqueId: row.file_unique_id,
    canonicalTitle: row.canonical_title,
    metadata,
    sources: sourceItems,
    annotations: annotationItems,
    jobs: jobItems,
  };
}
