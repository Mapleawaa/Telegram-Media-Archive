import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  name: z.string(),
  version: z.string(),
  uptimeSec: z.number(),
  startedAt: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const MEDIA_TYPES = ['video', 'photo', 'audio', 'animation', 'document', 'other'] as const;
// 'manual'：命中「跳过 AI」来源策略 → 不进模型，进人工分类队列
export const AI_STATUSES = ['pending', 'partial', 'done', 'failed', 'skipped', 'manual'] as const;
export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead'] as const;

export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;
export type AiStatus = (typeof AI_STATUSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 转发来源的四种形态 */
export const FORWARD_ORIGIN_TYPES = ['user', 'hidden_user', 'chat', 'channel'] as const;
export type ForwardOriginType = (typeof FORWARD_ORIGIN_TYPES)[number];

/** 来源策略规则的 key 前缀（与 AI 分流器一致） */
export const SOURCE_KEY_TYPES = ['channel', 'chat', 'user', 'name'] as const;
export type SourceKeyType = (typeof SOURCE_KEY_TYPES)[number];

/** 分类体系（六类 + 自定义字符串） */
export const CATEGORY_PRESETS = ['movie', 'series', 'anime', 'adult', 'gallery', 'other'] as const;
export type CategoryPreset = (typeof CATEGORY_PRESETS)[number];

/** 分类的赋值来源（优先级：user > llm > rule） */
export const CATEGORY_SOURCES = ['rule', 'llm', 'user'] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

/** 归一化分类字符串（自定义分类允许，但长度受限） */
export const CategoryValueSchema = z.string().trim().min(1).max(32);

/** 标题来源（'user' 即锁定：规则与 AI 不再覆盖 canonical_title） */
export const TITLE_SOURCES = ['rule', 'llm', 'vision', 'user'] as const;
export type TitleSource = (typeof TITLE_SOURCES)[number];

export interface MediaListItem {
  id: number;
  title: string;
  type: MediaType;
  mime: string | null;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  quality: string | null;
  year: number | null;
  aiStatus: AiStatus;
  sourceCount: number;
  tags: string[];
  hasThumbnail: boolean;
  createdAt: number;
  /** 单条「跳过 AI」开关状态 */
  aiSkip: boolean;
  /** 分类体系：movie/series/anime/adult/gallery/other 或自定义字符串 */
  category: string | null;
  /** 分类赋值来源（决定后续能否被覆盖：user 不可被 rule/llm 覆盖） */
  categorySource: CategorySource | null;
  /** 标题来源（'user' 表示手动改过，前端据此提示「不会再被 AI 覆盖」） */
  titleSource: TitleSource | null;
  /** 敏感标记（P4 隐私模式消费） */
  isSensitive: boolean;
  /** Telegram 相册组 id（同组媒体相邻渲染 + 相册角标） */
  mediaGroupId: string | null;
  /** 同相册组的媒体条数（1 = 非相册，>1 显示角标） */
  albumCount: number;
}

/** 归一化后的转发来源（详情页 / 人工分类面板展示用） */
export interface ForwardInfo {
  originType: ForwardOriginType;
  chatId: number | null;
  chatTitle: string | null;
  chatUsername: string | null;
  senderUserId: number | null;
  senderName: string | null;
}

export interface SourceItem {
  id: number;
  chatId: number;
  messageId: number;
  chatTitle: string | null;
  senderName: string | null;
  caption: string | null;
  messageDate: number;
  via: 'bot' | 'mtproto';
  isPrimary: boolean;
  forward: ForwardInfo | null;
}

export interface AnnotationItem {
  id: number;
  rawText: string;
  createdAt: number;
}

export interface JobItem {
  id: number;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface MediaMetadataItem {
  fileName: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  quality: string | null;
  codec: string | null;
  source: string | null;
  audio: string | null;
  titleNorm: string | null;
  summary: string | null;
  extractedBy: string | null;
}

export interface MediaDetail extends MediaListItem {
  fileUniqueId: string;
  canonicalTitle: string | null;
  metadata: MediaMetadataItem | null;
  sources: SourceItem[];
  annotations: AnnotationItem[];
  jobs: JobItem[];
}

/** 媒体库排序：recent/updated 走 keyset 游标；其余按字段排序（数据量小，前端一次取） */
export const MEDIA_SORTS = ['recent', 'relevance', 'size', 'duration', 'year', 'updated'] as const;
export type MediaSort = (typeof MEDIA_SORTS)[number];

export const MediaListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: MediaTypeSchema.optional(),
  quality: z.string().trim().min(1).optional(),
  year: z.coerce.number().int().optional(),
  tag: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).max(32).optional(),
  aiStatus: z.enum(AI_STATUSES).optional(),
  sort: z.enum(MEDIA_SORTS).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});
export type MediaListQuery = z.infer<typeof MediaListQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const SearchFiltersSchema = z.object({
  type: MediaTypeSchema.optional(),
  quality: z.string().trim().min(1).optional(),
  year: z.coerce.number().int().optional(),
  tag: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).max(32).optional(),
  aiStatus: z.enum(AI_STATUSES).optional(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(1),
  filters: SearchFiltersSchema.default({}),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export interface SearchDebug {
  strategy: 'fts' | 'like' | 'hybrid' | 'none';
  ftsHits: number;
  vectorHits: number;
  reranked: number;
  tookMs: number;
}

export interface SearchResponse {
  items: MediaListItem[];
  debug: SearchDebug;
}

export const ForwardRequestSchema = z.object({
  targetChatId: z.coerce.number().int().optional(),
  mode: z.enum(['forward', 'copy']).optional(),
  /** 多来源时指定要转发的来源消息（telegram_message.id）；缺省用主源 */
  sourceMessageId: z.coerce.number().int().optional(),
  /** 相册整组转发（P5-3 / B13）：按组内顺序逐条发送 */
  album: z.boolean().optional(),
});
export type ForwardRequest = z.infer<typeof ForwardRequestSchema>;

export interface ForwardResponse {
  ok: true;
  chatId: number;
  messageId: number;
  mode: 'forward' | 'copy';
  /** album=true 时：逐条发送的结果 */
  album?: boolean;
  count?: number;
  items?: { mediaId: number; chatId: number; messageId: number }[];
}

export const TagRequestSchema = z.object({
  tag: z.string().trim().min(1).max(64),
});
export type TagRequest = z.infer<typeof TagRequestSchema>;

export const AnnotateRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});
export type AnnotateRequest = z.infer<typeof AnnotateRequestSchema>;

export interface StatsResponse {
  totalAssets: number;
  todayAdded: number;
  jobsByStatus: Record<string, number>;
  recentMedia: MediaListItem[];
  recentFailures: JobItem[];
}

export interface AiRunItem {
  id: number;
  kind: string;
  status: string;
  provider: string | null;
  model: string | null;
  userRequest: string | null;
  totalTokens: number | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface AiStepItem {
  id: number;
  runId: number;
  stepIndex: number;
  type: string;
  toolName: string | null;
  input: unknown;
  output: unknown;
  status: string;
  latencyMs: number | null;
  tokenUsage: unknown;
  error: string | null;
  createdAt: number;
}

export interface AiRunDetail extends AiRunItem {
  steps: AiStepItem[];
}

export interface InboxResponse {
  pending: MediaListItem[];
  partial: MediaListItem[];
  failed: MediaListItem[];
  done: MediaListItem[];
  /** 命中「跳过 AI」来源策略、等人工分类的媒体 */
  manual: MediaListItem[];
}

/** 观察到的转发来源（来源与 AI 策略面板） */
export interface SourceForwardItem {
  /** 策略 key：channel:<chatId> / chat:<chatId> / user:<userId> / name:<senderName> */
  key: string;
  type: SourceKeyType;
  chatId: number | null;
  title: string | null;
  username: string | null;
  name: string | null;
  count: number;
  lastSeenAt: number;
  /** 该来源下已命中跳过策略（ai_status !== 正常走 AI）的条数 */
  skippedCount: number;
}

export interface SourcesForwardResponse {
  items: SourceForwardItem[];
  /** 当前生效的跳过列表 */
  skipSources: string[];
}

export const AiPolicyRequestSchema = z.object({
  skip: z.boolean(),
});
export type AiPolicyRequest = z.infer<typeof AiPolicyRequestSchema>;

export const ClassifyRequestSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  category: CategoryValueSchema.optional(),
  sensitive: z.boolean().optional(),
});
export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

export interface ClassifyResponse {
  ok: true;
  mediaId: number;
  tagsAdded: number;
  category: string | null;
  sensitive: boolean;
}

export interface TagCountItem {
  tag: string;
  count: number;
}

export interface TagTopResponse {
  items: TagCountItem[];
}

export const EnrichRequestSchema = z.object({
  force: z.boolean().optional(),
});
export type EnrichRequest = z.infer<typeof EnrichRequestSchema>;

export interface CapabilityStatus {
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
}

export interface AiCapabilitiesResponse {
  providerKind: 'none' | 'mock' | 'openai';
  chat: CapabilityStatus;
  vision: CapabilityStatus;
  embed: CapabilityStatus;
  vector: {
    available: boolean;
    dim: number | null;
    embeddedCount: number;
  };
}

export const SettingsPatchSchema = z.object({
  key: z.string().trim().min(1).max(128),
  value: z.unknown(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export interface SettingsMap {
  [key: string]: unknown;
}

export const SETTING_KEYS = {
  forwardTargetChatId: 'forward_target_chat_id',
  forwardMode: 'forward_mode',
  embeddingModel: 'embedding_model',
  embeddingDim: 'embedding_dim',
  /** string[]：命中即进人工分类队列，不进模型 */
  aiSkipSources: 'ai_skip_sources',
  /** number：Bot 私聊通知的目标 chat id（0/未设置 = 关闭通知）。X1 由 /start /stop 维护 */
  notifyChatId: 'notify_chat_id',
} as const;

// ---- P3 分类体系 ----

/** 分类夹（P4 影音墙消费）：一个分类 = 名称 + 计数 + 预览图 */
export interface LibrarySection {
  /** 分类 key：movie/series/anime/adult/gallery/other 或自定义；未分类为 __none__ */
  key: string;
  label: string;
  count: number;
  /** 预览（最新若干条） */
  items: MediaListItem[];
}

export interface LibrarySectionsResponse {
  sections: LibrarySection[];
  total: number;
}

// ---- P5-4 见过的 chat（转发目标下拉） ----

export interface SeenChatItem {
  chatId: number;
  chatTitle: string | null;
  chatType: string | null;
  /** 该 chat 里 Bot 见过的消息数（越大越可信） */
  count: number;
  lastSeenAt: number;
  /** 归档群本身：转发目标不该选它 */
  isArchive: boolean;
}

export interface SeenChatsResponse {
  items: SeenChatItem[];
}

// ---- P3 标签压缩作业 ----

/** 批量入队标签压缩 */
export interface ConsolidateTagsResponse {
  ok: true;
  total: number;
  enqueued: number;
}

/** 单条标签压缩结果（保留以便追溯） */
export interface ConsolidateTagsResult {
  mediaId: number;
  /** 保留标签数 */
  kept: number;
  /** 被删除的标签（低价值/冗余） */
  dropped: string[];
  /** 被合并的标签：原名 → 归并名 */
  merged: Record<string, string>;
  /** 顺带修正的分类（若模型给出且未被用户锁定） */
  category: string | null;
}
