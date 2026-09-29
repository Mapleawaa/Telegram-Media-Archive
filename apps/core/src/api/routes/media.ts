import fs from 'node:fs';
import {
  AiPolicyRequestSchema,
  AnnotateRequestSchema,
  ClassifyRequestSchema,
  ForwardRequestSchema,
  MediaListQuerySchema,
  SETTING_KEYS,
  TagRequestSchema,
  type ClassifyResponse,
  type ForwardResponse,
  type MediaDetail,
  type MediaListItem,
  type Page,
} from '@tma/shared';
import { and, eq } from 'drizzle-orm';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import { mediaAnnotation, mediaAsset, mediaTag } from '../../database/schema.js';
import { getMediaDetail, queryMedia } from '../../media/queries.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';
import { normalizeTag } from '../../metadata/tag-policy.js';
import { hybridSearch } from '../../search/orchestrator.js';
import { getSetting } from '../../settings/store.js';
import { ensureThumbnail } from '../../telegram/bot/thumbnail.js';
import type { TelegramClient } from '../../telegram/client.js';

export interface ServerDeps {
  tg: TelegramClient;
}

function cleanQuery(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object') return {};
  return Object.fromEntries(
    Object.entries(query as Record<string, unknown>).filter(
      ([, v]) => v !== undefined && v !== '' && v !== null,
    ),
  );
}

function parseId(params: unknown): number | null {
  const raw = (params as { id?: string }).id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerMediaRoutes(
  app: AppServer,
  ctx: AppContext,
  deps: ServerDeps,
): void {
  app.get('/api/media', async (req): Promise<Page<MediaListItem>> => {
    const query = MediaListQuerySchema.parse(cleanQuery(req.query));
    const filters = {
      type: query.type,
      quality: query.quality,
      year: query.year,
      tag: query.tag,
      category: query.category,
      aiStatus: query.aiStatus,
    };

    if (query.q) {
      const hybrid = await hybridSearch(ctx, ctx.ai, {
        query: query.q,
        filters,
        limit: query.limit,
      });
      return { items: hybrid.items, nextCursor: null };
    }

    return queryMedia(ctx.sqlite, {
      filters,
      limit: query.limit,
      cursor: query.cursor,
      order: query.sort,
    });
  });

  app.get('/api/media/:id', async (req, reply): Promise<MediaDetail | undefined> => {
    const id = parseId(req.params);
    if (id === null) {
      await reply.status(400).send({ error: 'invalid_id' });
      return;
    }
    const detail = getMediaDetail(ctx, id);
    if (!detail) {
      await reply.status(404).send({ error: 'not_found' });
      return;
    }
    return detail;
  });

  app.get('/api/media/:id/thumbnail', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const filePath = await ensureThumbnail(ctx, deps.tg, id);
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'no_thumbnail' });
    }
    return reply
      .header('Cache-Control', 'public, max-age=86400')
      .type('image/jpeg')
      .send(fs.readFileSync(filePath));
  });

  app.post('/api/media/:id/tag', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const { tag } = TagRequestSchema.parse(req.body ?? {});
    if (!getMediaDetail(ctx, id)) return reply.status(404).send({ error: 'not_found' });

    ctx.db
      .insert(mediaTag)
      .values({ mediaAssetId: id, tag, source: 'user' })
      .onConflictDoNothing()
      .run();
    rebuildSearchDoc(ctx, id);
    ctx.bus.emit('media.updated', { mediaId: id, tag }, 'user');
    return { ok: true };
  });

  app.delete('/api/media/:id/tag/:tag', async (req, reply) => {
    const id = parseId(req.params);
    const tag = decodeURIComponent((req.params as { tag: string }).tag ?? '');
    if (id === null || !tag) return reply.status(400).send({ error: 'invalid_request' });
    ctx.db
      .delete(mediaTag)
      .where(
        and(eq(mediaTag.mediaAssetId, id), eq(mediaTag.tag, tag), eq(mediaTag.source, 'user')),
      )
      .run();
    rebuildSearchDoc(ctx, id);
    ctx.bus.emit('media.updated', { mediaId: id, tag, removed: true }, 'user');
    return { ok: true };
  });

  /**
   * 人工分类（P2-4）：写入用户标签 + 分类 + 敏感标记，收尾 `ai_status='manual'` 流程。
   * 走人工的媒体不产生任何 ai_runs 记录——这正是「AI 介入分流器」的目的。
   */
  app.post('/api/media/:id/classify', async (req, reply): Promise<ClassifyResponse | undefined> => {
    const id = parseId(req.params);
    if (id === null) {
      await reply.status(400).send({ error: 'invalid_id' });
      return;
    }
    const body = ClassifyRequestSchema.parse(req.body ?? {});
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) {
      await reply.status(404).send({ error: 'not_found' });
      return;
    }

    // 用户显式输入：只做归一化与去重，不做「低价值过滤」（用户的意图优先）
    const seen = new Set<string>();
    let tagsAdded = 0;
    for (const raw of body.tags) {
      const tag = normalizeTag(raw);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      const info = ctx.db
        .insert(mediaTag)
        .values({ mediaAssetId: id, tag, source: 'user' })
        .onConflictDoNothing()
        .run();
      tagsAdded += info.changes;
    }

    const category = body.category ?? asset.category;
    const sensitive = body.sensitive ?? asset.isSensitive;

    ctx.db
      .update(mediaAsset)
      .set({
        category,
        categorySource: body.category ? 'user' : asset.categorySource,
        isSensitive: sensitive,
        aiStatus: 'skipped',
        updatedAt: new Date(),
      })
      .where(eq(mediaAsset.id, id))
      .run();

    rebuildSearchDoc(ctx, id);
    ctx.bus.emit(
      'media.classified',
      { mediaId: id, tags: [...seen], category: category ?? null, sensitive },
      'user',
    );
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'classified' }, 'user');
    return { ok: true, mediaId: id, tagsAdded, category: category ?? null, sensitive };
  });

  /**
   * 单条 AI 策略覆盖（P2-5）：
   * skip=true → 撤掉未跑的 AI 任务、置 manual（进人工分类队列）
   * skip=false → 重新入队 ai.enrich，交回 AI 流程
   */
  app.post('/api/media/:id/ai-policy', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const { skip } = AiPolicyRequestSchema.parse(req.body ?? {});
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'not_found' });

    if (skip) {
      const cancelled = ctx.queue.cancelForMedia(id, '用户手动跳过 AI');
      ctx.db
        .update(mediaAsset)
        .set({ aiSkip: true, aiStatus: 'manual', updatedAt: new Date() })
        .where(eq(mediaAsset.id, id))
        .run();
      ctx.bus.emit('media.manual_review', { mediaId: id, reason: 'manual_override' }, 'user');
      ctx.bus.emit('media.updated', { mediaId: id, reason: 'ai_skipped' }, 'user');
      return { ok: true, mediaId: id, skip: true, aiStatus: 'manual', cancelledJobs: cancelled };
    }

    const enqueue = ctx.ai.enrichEnabled;
    ctx.db
      .update(mediaAsset)
      .set({ aiSkip: false, aiStatus: enqueue ? 'pending' : 'skipped', updatedAt: new Date() })
      .where(eq(mediaAsset.id, id))
      .run();
    const jobId = enqueue
      ? ctx.queue.enqueue('ai.enrich', { mediaId: id }, { dedupeKey: `ai.enrich:${id}`, priority: 2 })
      : undefined;
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'ai_resumed' }, 'user');
    return {
      ok: true,
      mediaId: id,
      skip: false,
      aiStatus: enqueue ? 'pending' : 'skipped',
      jobId: jobId ?? null,
    };
  });

  app.post('/api/media/:id/annotate', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const { text } = AnnotateRequestSchema.parse(req.body ?? {});
    if (!getMediaDetail(ctx, id)) return reply.status(404).send({ error: 'not_found' });

    const row = ctx.db
      .insert(mediaAnnotation)
      .values({ mediaAssetId: id, rawText: text })
      .returning({ id: mediaAnnotation.id })
      .get();
    ctx.bus.emit('annotation.created', { mediaId: id, annotationId: row.id }, 'user');
    return { ok: true, id: row.id };
  });

  app.post('/api/media/:id/forward', async (req, reply): Promise<ForwardResponse | undefined> => {
    const id = parseId(req.params);
    if (id === null) {
      await reply.status(400).send({ error: 'invalid_id' });
      return;
    }
    const body = ForwardRequestSchema.parse(req.body ?? {});
    const detail = getMediaDetail(ctx, id);
    if (!detail) {
      await reply.status(404).send({ error: 'not_found' });
      return;
    }

    const targetChatId =
      body.targetChatId ?? getSetting<number>(ctx, SETTING_KEYS.forwardTargetChatId);
    if (!targetChatId) {
      await reply.status(400).send({ error: 'no_target_chat', message: '未配置转发目标会话' });
      return;
    }
    const mode = body.mode ?? getSetting<'forward' | 'copy'>(ctx, SETTING_KEYS.forwardMode) ?? 'copy';

    const source = detail.sources.find((s) => s.isPrimary) ?? detail.sources[0];
    if (!source) {
      await reply.status(404).send({ error: 'no_source', message: '该媒体没有 Telegram 来源消息' });
      return;
    }

    const result = await deps.tg.sendMedia(
      { chatId: source.chatId, messageId: source.messageId },
      targetChatId,
      mode,
    );
    ctx.bus.emit(
      'telegram.message.forwarded',
      { mediaId: id, chatId: result.chatId, messageId: result.messageId, mode },
      'user',
    );
    return { ok: true, chatId: result.chatId, messageId: result.messageId, mode };
  });
}
