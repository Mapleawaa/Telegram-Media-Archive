import type {
  AiCapabilitiesResponse,
  AiRunDetail,
  AiRunItem,
  AiStepItem,
  InboxResponse,
  MediaListItem,
} from '@tma/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context.js';
import { mediaAsset } from '../../database/schema.js';
import { queryMedia } from '../../media/queries.js';
import { getVecDim, vectorCount } from '../../vector/store.js';
import type { AppServer } from '../types.js';

interface RawRun {
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

interface RawStep {
  id: number;
  runId: number;
  stepIndex: number;
  type: string;
  toolName: string | null;
  input: string | null;
  output: string | null;
  status: string;
  latencyMs: number | null;
  tokenUsage: string | null;
  error: string | null;
  createdAt: number;
}

function mapRun(row: RawRun): AiRunItem {
  return { ...row };
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function mapStep(row: RawStep): AiStepItem {
  return {
    ...row,
    input: parseJson(row.input),
    output: parseJson(row.output),
    tokenUsage: parseJson(row.tokenUsage),
  };
}

const RUN_SELECT = `SELECT id, kind, status, provider, model, user_request AS userRequest,
                           total_tokens AS totalTokens, started_at AS startedAt,
                           finished_at AS finishedAt, error
                    FROM ai_runs`;

export function registerAiRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/ai/capabilities', async (): Promise<AiCapabilitiesResponse> => {
    const described = ctx.ai.describe();
    let embeddedCount = 0;
    let dim: number | null = null;
    let vectorAvailable = false;
    try {
      dim = getVecDim(ctx.sqlite);
      vectorAvailable = dim !== null;
      if (vectorAvailable) embeddedCount = vectorCount(ctx.sqlite);
    } catch {
      vectorAvailable = false;
    }
    return {
      ...described,
      vector: { available: vectorAvailable, dim, embeddedCount },
    };
  });

  app.post('/api/media/:id/enrich', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'invalid_id' });
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'not_found' });

    if (!ctx.ai.enrichEnabled) {
      return reply.status(400).send({
        error: 'ai_disabled',
        message: 'AI 未启用：请在 .env 配置 AI_BASE_URL/AI_API_KEY/AI_CHAT_MODEL（或设 AI_PROVIDER=mock 演示）',
      });
    }

    const jobId = ctx.queue.enqueue(
      'ai.enrich',
      { mediaId: id },
      { dedupeKey: `ai.enrich:${id}`, priority: 2 },
    );
    ctx.db
      .update(mediaAsset)
      .set({ aiStatus: 'pending', updatedAt: new Date() })
      .where(eq(mediaAsset.id, id))
      .run();
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'enrich_enqueued' }, 'user');
    return { ok: true, jobId: jobId ?? null, deduped: jobId === undefined };
  });

  app.get('/api/ai/runs', async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string })?.limit) || 50, 200);
    const rows = ctx.sqlite
      .prepare(`${RUN_SELECT} ORDER BY id DESC LIMIT ?`)
      .all(limit) as RawRun[];
    return { items: rows.map(mapRun) };
  });

  app.get('/api/ai/runs/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'invalid_id' });
    const run = ctx.sqlite.prepare(`${RUN_SELECT} WHERE id = ?`).get(id) as RawRun | undefined;
    if (!run) return reply.status(404).send({ error: 'not_found' });

    const steps = ctx.sqlite
      .prepare(
        `SELECT id, run_id AS runId, step_index AS stepIndex, type, tool_name AS toolName,
                input, output, status, latency_ms AS latencyMs, token_usage AS tokenUsage,
                error, created_at AS createdAt
         FROM ai_steps WHERE run_id = ? ORDER BY step_index ASC`,
      )
      .all(id) as RawStep[];

    const detail: AiRunDetail = { ...mapRun(run), steps: steps.map(mapStep) };
    return detail;
  });

  app.get('/api/inbox', async (): Promise<InboxResponse> => {
    const group = (status: 'pending' | 'partial' | 'failed' | 'done' | 'manual'): MediaListItem[] =>
      queryMedia(ctx.sqlite, {
        filters: { aiStatus: status },
        limit: 50,
        order: 'recent',
      }).items;
    return {
      pending: group('pending'),
      partial: group('partial'),
      failed: group('failed'),
      done: group('done'),
      manual: group('manual'),
    };
  });
}
