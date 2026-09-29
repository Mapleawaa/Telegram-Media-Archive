import type {
  AiCapabilitiesResponse,
  AiPolicyRequest,
  AiRunDetail,
  AiRunItem,
  ClassifyRequest,
  ClassifyResponse,
  ForwardRequest,
  ForwardResponse,
  HealthResponse,
  InboxResponse,
  JobItem,
  MediaDetail,
  MediaListQuery,
  MediaListItem,
  Page,
  SearchRequest,
  SearchResponse,
  SourcesForwardResponse,
  StatsResponse,
  TagTopResponse,
} from '@tma/shared';

const CORE_URL_KEY = 'tma.coreUrl';
const DEFAULT_CORE_URL = 'http://127.0.0.1:8787';

export function getCoreUrl(): string {
  return localStorage.getItem(CORE_URL_KEY) ?? DEFAULT_CORE_URL;
}

export function setCoreUrl(url: string): void {
  localStorage.setItem(CORE_URL_KEY, url.replace(/\/$/, ''));
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getCoreUrl()}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'core_unreachable', 'Core 未连接');
  }
  if (!res.ok) {
    let code = 'http_error';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      code = body.error ?? code;
      message = body.message ?? message;
    } catch {
      // 非 JSON 错误体
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export interface SettingsResponse {
  settings: Record<string, unknown>;
  archiveChatId: number;
  dataDir: string;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  stats: () => request<StatsResponse>('/api/stats'),
  media: (query: Partial<MediaListQuery> & { cursor?: string }) =>
    request<Page<MediaListItem>>(`/api/media${queryString(query)}`),
  mediaDetail: (id: number) => request<MediaDetail>(`/api/media/${id}`),
  search: (body: SearchRequest) =>
    request<SearchResponse>('/api/search', { method: 'POST', body: JSON.stringify(body) }),
  forward: (id: number, body: ForwardRequest) =>
    request<ForwardResponse>(`/api/media/${id}/forward`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  addTag: (id: number, tag: string) =>
    request<{ ok: true }>(`/api/media/${id}/tag`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    }),
  removeTag: (id: number, tag: string) =>
    request<{ ok: true }>(`/api/media/${id}/tag/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    }),
  annotate: (id: number, text: string) =>
    request<{ ok: true; id: number }>(`/api/media/${id}/annotate`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  jobs: (status?: string) =>
    request<{ items: JobItem[] }>(`/api/jobs${queryString({ status, limit: 100 })}`),
  retryJob: (id: number) =>
    request<{ ok: boolean }>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  settings: () => request<SettingsResponse>('/api/settings'),
  patchSetting: (key: string, value: unknown) =>
    request<{ ok: true }>('/api/settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
  reindexSearch: () =>
    request<{ ok: true; count: number; tagsAdded: number; tookMs: number }>(
      '/api/admin/reindex-search',
      { method: 'POST' },
    ),
  enrich: (id: number) =>
    request<{ ok: true; jobId: number | null; deduped: boolean }>(`/api/media/${id}/enrich`, {
      method: 'POST',
    }),
  aiCapabilities: () => request<AiCapabilitiesResponse>('/api/ai/capabilities'),
  reindexEmbeddings: () =>
    request<{ ok: true; total: number; enqueued: number }>('/api/admin/reindex-embeddings', {
      method: 'POST',
    }),
  inbox: () => request<InboxResponse>('/api/inbox'),
  aiRuns: (limit = 50) => request<{ items: AiRunItem[] }>(`/api/ai/runs?limit=${limit}`),
  sourcesForward: () => request<SourcesForwardResponse>('/api/sources/forward'),
  tagsTop: (source = 'user', limit = 20) =>
    request<TagTopResponse>(`/api/tags/top${queryString({ source, limit })}`),
  classify: (id: number, body: ClassifyRequest) =>
    request<ClassifyResponse>(`/api/media/${id}/classify`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setAiPolicy: (id: number, body: AiPolicyRequest) =>
    request<{ ok: true; mediaId: number; skip: boolean; aiStatus: string; jobId?: number | null }>(
      `/api/media/${id}/ai-policy`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  aiRunDetail: (id: number) => request<AiRunDetail>(`/api/ai/runs/${id}`),
  thumbnailUrl: (id: number) => `${getCoreUrl()}/api/media/${id}/thumbnail`,
  wsUrl: () => `${getCoreUrl().replace(/^http/, 'ws')}/ws`,
};
