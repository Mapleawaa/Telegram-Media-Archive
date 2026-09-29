import type { Database } from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type {
  AnnotationItem,
  CategorySource,
  TitleSource,
  ForwardInfo,
  JobItem,
  JobStatus,
  MediaDetail,
  MediaListItem,
  MediaMetadataItem,
  MediaSort,
  MediaType,
  Page,
  SearchFilters,
  SourceItem,
} from '@tma/shared';
import type { AppContext } from '../context.js';
import { mediaAnnotation, mediaMetadata, telegramMessage } from '../database/schema.js';
import { UNCATEGORIZED_KEY } from '../metadata/category.js';
import { isJunkTitle } from '../metadata/title-policy.js';

export interface ListOptions {
  filters: SearchFilters;
  limit: number;
  cursor?: string;
  candidateIds?: number[];
  order: MediaSort;
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
  ai_skip: number;
  created_at: number;
  file_unique_id: string;
  quality: string | null;
  year: number | null;
  title_norm: string | null;
  file_name: string | null;
  category: string | null;
  category_source: string | null;
  title_source: string | null;
  is_sensitive: number;
  media_group_id: string | null;
  album_count: number;
  source_count: number;
  primary_thumb: string | null;
  tags: string | null;
}

const LIST_SELECT = `
SELECT a.id, a.canonical_title, a.type, a.mime, a.size, a.duration_sec, a.width, a.height,
       a.ai_status, a.ai_skip, a.created_at, a.file_unique_id,
       a.category, a.category_source, a.title_source, a.is_sensitive,
       m.quality, m.year, m.title_norm, m.file_name,
       (SELECT gm.media_group_id FROM telegram_message gm
         WHERE gm.media_asset_id = a.id AND gm.media_group_id IS NOT NULL
         ORDER BY gm.is_primary DESC, gm.id ASC LIMIT 1) AS media_group_id,
       (SELECT COUNT(DISTINCT am.media_asset_id) FROM telegram_message am
         WHERE am.media_group_id = (SELECT gm2.media_group_id FROM telegram_message gm2
           WHERE gm2.media_asset_id = a.id AND gm2.media_group_id IS NOT NULL
           ORDER BY gm2.is_primary DESC, gm2.id ASC LIMIT 1)) AS album_count,
       (SELECT COUNT(*) FROM telegram_message tm WHERE tm.media_asset_id = a.id) AS source_count,
       (SELECT tm.thumbnail_file_id FROM telegram_message tm
         WHERE tm.media_asset_id = a.id AND tm.is_primary = 1 LIMIT 1) AS primary_thumb,
       (SELECT group_concat(DISTINCT t.tag) FROM media_tag t WHERE t.media_asset_id = a.id) AS tags
FROM media_asset a
LEFT JOIN media_metadata m ON m.media_asset_id = a.id
`;

/** 排序 SQL（除 recent 外为一次性排序：数据量小，不做 keyset 游标） */
const ORDER_SQL: Record<MediaSort, string> = {
  recent: 'a.created_at DESC, a.id DESC',
  relevance: 'a.created_at DESC, a.id DESC',
  size: 'a.size DESC, a.id DESC',
  duration: '(a.duration_sec IS NULL) ASC, a.duration_sec DESC, a.id DESC',
  year: '(m.year IS NULL) ASC, m.year DESC, a.id DESC',
  updated: 'a.updated_at DESC, a.id DESC',
};

const TYPE_LABELS: Record<string, string> = {
  video: '视频',
  photo: '图片',
  audio: '音频',
  animation: '动图',
  document: '文档',
};

/** 展示标题兜底链：canonical → 规则标题（跳过垃圾）→ 文件名（跳过垃圾）→ 类型 #id */
function displayTitle(row: ListRow): string {
  if (row.canonical_title && !isJunkTitle(row.canonical_title)) return row.canonical_title;
  if (row.title_norm && !isJunkTitle(row.title_norm)) return row.title_norm;
  if (row.file_name && !isJunkTitle(row.file_name)) return row.file_name;
  return row.canonical_title ?? `${TYPE_LABELS[row.type] ?? row.type} #${row.id}`;
}

function mapListRow(row: ListRow): MediaListItem {
  return {
    id: row.id,
    title: displayTitle(row),
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
    aiSkip: row.ai_skip === 1,
    category: row.category,
    categorySource: (row.category_source as CategorySource | null) ?? null,
    titleSource: (row.title_source as TitleSource | null) ?? null,
    isSensitive: row.is_sensitive === 1,
    mediaGroupId: row.media_group_id,
    // 非相册（media_group_id IS NULL）时子查询恒为 0 → 归一为 1（契约：1 = 非相册）
    albumCount: row.album_count && row.album_count > 0 ? row.album_count : 1,
  };
}

function mapForward(s: {
  forwardOriginType: string | null;
  forwardFromChatId: number | null;
  forwardFromChatTitle: string | null;
  forwardFromChatUsername: string | null;
  forwardSenderUserId: number | null;
  forwardSenderName: string | null;
}): ForwardInfo | null {
  if (!s.forwardOriginType) return null;
  return {
    originType: s.forwardOriginType as ForwardInfo['originType'],
    chatId: s.forwardFromChatId,
    chatTitle: s.forwardFromChatTitle,
    chatUsername: s.forwardFromChatUsername,
    senderUserId: s.forwardSenderUserId,
    senderName: s.forwardSenderName,
  };
}

function buildWhere(filters: SearchFilters, cursor: string | undefined): {
  sql: string;
  params: Record<string, unknown>;
} {
  // 软删除（P5-1）：一切列表/检索默认排除已删除的媒体
  const where: string[] = ['a.deleted_at IS NULL'];
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
  if (filters.category) {
    if (filters.category === UNCATEGORIZED_KEY) {
      where.push('a.category IS NULL');
    } else {
      where.push('a.category = @category');
      params.category = filters.category;
    }
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
  // 只有「最新」用 keyset 游标分页；其余排序一次性返回（数据量小，前端自行处理）
  const keyset = opts.order === 'recent';
  const { sql, params } = buildWhere(opts.filters, keyset ? opts.cursor : undefined);
  const orderSql = ORDER_SQL[opts.order] ?? ORDER_SQL.recent;

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
      `${LIST_SELECT} ${sql} ORDER BY ${orderSql} LIMIT @limit`,
    )
    .all({ ...params, limit: opts.limit + 1 }) as ListRow[];

  const hasMore = rows.length > opts.limit;
  const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = keyset && hasMore && last ? `${last.created_at}:${last.id}` : null;

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
    forward: mapForward(s),
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
