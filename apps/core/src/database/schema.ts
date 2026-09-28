import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const MEDIA_TYPES = ['video', 'photo', 'audio', 'animation', 'document', 'other'] as const;
export const AI_STATUSES = ['pending', 'partial', 'done', 'failed', 'skipped'] as const;
export const MESSAGE_VIAS = ['bot', 'mtproto'] as const;
export const TAG_SOURCES = ['user', 'rule', 'llm', 'vision'] as const;
export const EXTRACTED_BY = ['rule', 'llm', 'vision', 'mixed'] as const;
export const EMBEDDING_KINDS = ['text', 'image'] as const;
export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead'] as const;
export const RUN_KINDS = ['enrich', 'embedding', 'agent', 'search', 'rerank'] as const;
export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export const STEP_TYPES = [
  'intent',
  'model_call',
  'tool_call',
  'tool_result',
  'retrieval',
  'rerank',
  'decision',
  'error',
] as const;
export const STEP_STATUSES = ['running', 'succeeded', 'failed'] as const;
export const AUDIT_ACTORS = ['bot', 'user', 'agent', 'system', 'mtproto'] as const;

const nowMs = sql`(unixepoch() * 1000)`;

export const mediaAsset = sqliteTable(
  'media_asset',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fileUniqueId: text('file_unique_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    canonicalTitle: text('canonical_title'),
    type: text('type', { enum: MEDIA_TYPES }).notNull(),
    mime: text('mime'),
    size: integer('size').notNull(),
    durationSec: integer('duration_sec'),
    width: integer('width'),
    height: integer('height'),
    preferredMessageId: integer('preferred_message_id'),
    aiStatus: text('ai_status', { enum: AI_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('ux_asset_file_unique').on(t.fileUniqueId),
    uniqueIndex('ux_asset_dedupe').on(t.dedupeKey),
    index('ix_asset_created').on(t.createdAt, t.id),
    index('ix_asset_type_created').on(t.type, t.createdAt),
    index('ix_asset_ai_status').on(t.aiStatus),
  ],
);

export const telegramMessage = sqliteTable(
  'telegram_message',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaAssetId: integer('media_asset_id')
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').notNull(),
    messageId: integer('message_id').notNull(),
    chatType: text('chat_type'),
    chatTitle: text('chat_title'),
    mediaGroupId: text('media_group_id'),
    senderId: integer('sender_id'),
    senderName: text('sender_name'),
    fileId: text('file_id').notNull(),
    fileUniqueId: text('file_unique_id').notNull(),
    thumbnailFileId: text('thumbnail_file_id'),
    caption: text('caption'),
    captionEntities: text('caption_entities', { mode: 'json' }),
    messageDate: integer('message_date', { mode: 'timestamp_ms' }).notNull(),
    via: text('via', { enum: MESSAGE_VIAS }).notNull().default('bot'),
    remoteRef: text('remote_ref', { mode: 'json' }),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    raw: text('raw', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('ux_msg_chat_msg').on(t.chatId, t.messageId),
    index('ix_msg_asset').on(t.mediaAssetId),
    index('ix_msg_unique').on(t.fileUniqueId),
    index('ix_msg_date').on(t.messageDate),
  ],
);

export const mediaMetadata = sqliteTable(
  'media_metadata',
  {
    mediaAssetId: integer('media_asset_id')
      .primaryKey()
      .references(() => mediaAsset.id, { onDelete: 'cascade' }),
    fileName: text('file_name'),
    year: integer('year'),
    season: integer('season'),
    episode: integer('episode'),
    quality: text('quality'),
    codec: text('codec'),
    source: text('source'),
    audio: text('audio'),
    titleNorm: text('title_norm'),
    description: text('description'),
    summary: text('summary'),
    extractedBy: text('extracted_by', { enum: EXTRACTED_BY }),
    parserVersion: text('parser_version'),
    rawParse: text('raw_parse', { mode: 'json' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [index('ix_meta_quality').on(t.quality), index('ix_meta_year').on(t.year)],
);

export const mediaTag = sqliteTable(
  'media_tag',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaAssetId: integer('media_asset_id')
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    source: text('source', { enum: TAG_SOURCES }).notNull(),
    confidence: real('confidence'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex('ux_tag_asset_tag_src').on(t.mediaAssetId, t.tag, t.source),
    index('ix_tag_tag').on(t.tag),
  ],
);

export const mediaAnnotation = sqliteTable(
  'media_annotation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaAssetId: integer('media_asset_id')
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    rawText: text('raw_text').notNull(),
    parsedIntent: text('parsed_intent', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [index('ix_ann_asset').on(t.mediaAssetId)],
);

export const mediaEmbedding = sqliteTable(
  'media_embedding',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaAssetId: integer('media_asset_id')
      .notNull()
      .references(() => mediaAsset.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: EMBEDDING_KINDS }).notNull(),
    model: text('model').notNull(),
    dim: integer('dim').notNull(),
    contentHash: text('content_hash').notNull(),
    sourceDoc: text('source_doc', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex('ux_emb_asset_kind_model').on(t.mediaAssetId, t.kind, t.model)],
);

export const mediaSearchDoc = sqliteTable('media_search_doc', {
  docId: integer('doc_id').primaryKey(),
  title: text('title'),
  filename: text('filename'),
  caption: text('caption'),
  tags: text('tags'),
  summary: text('summary'),
  extra: text('extra'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
});

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    dedupeKey: text('dedupe_key'),
    availableAt: integer('available_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [
    index('ix_jobs_poll').on(t.status, t.availableAt, t.priority),
    uniqueIndex('ux_jobs_active')
      .on(t.type, t.dedupeKey)
      .where(sql`status in ('pending', 'running')`),
  ],
);

export const aiRuns = sqliteTable(
  'ai_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: RUN_KINDS }).notNull(),
    userRequest: text('user_request'),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    provider: text('provider'),
    model: text('model'),
    context: text('context', { mode: 'json' }),
    totalTokens: integer('total_tokens'),
    totalCost: real('total_cost'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    error: text('error'),
  },
  (t) => [index('ix_runs_started').on(t.startedAt)],
);

export const aiSteps = sqliteTable(
  'ai_steps',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    type: text('type', { enum: STEP_TYPES }).notNull(),
    toolName: text('tool_name'),
    input: text('input', { mode: 'json' }),
    output: text('output', { mode: 'json' }),
    status: text('status', { enum: STEP_STATUSES }).notNull(),
    latencyMs: integer('latency_ms'),
    tokenUsage: text('token_usage', { mode: 'json' }),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex('ux_step_run_idx').on(t.runId, t.stepIndex)],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    event: text('event').notNull(),
    mediaAssetId: integer('media_asset_id'),
    chatId: integer('chat_id'),
    actor: text('actor', { enum: AUDIT_ACTORS }).notNull(),
    payload: text('payload', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (t) => [
    index('ix_audit_created').on(t.createdAt),
    index('ix_audit_asset').on(t.mediaAssetId),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
});
