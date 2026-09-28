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
export const AI_STATUSES = ['pending', 'partial', 'done', 'failed', 'skipped'] as const;
export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead'] as const;

export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;
export type AiStatus = (typeof AI_STATUSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

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

export const MediaListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: MediaTypeSchema.optional(),
  quality: z.string().trim().min(1).optional(),
  year: z.coerce.number().int().optional(),
  tag: z.string().trim().min(1).optional(),
  aiStatus: z.enum(AI_STATUSES).optional(),
  sort: z.enum(['recent', 'relevance']).default('recent'),
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
  strategy: 'fts' | 'like' | 'none';
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
});
export type ForwardRequest = z.infer<typeof ForwardRequestSchema>;

export interface ForwardResponse {
  ok: true;
  chatId: number;
  messageId: number;
  mode: 'forward' | 'copy';
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
}

export const EnrichRequestSchema = z.object({
  force: z.boolean().optional(),
});
export type EnrichRequest = z.infer<typeof EnrichRequestSchema>;

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
} as const;
