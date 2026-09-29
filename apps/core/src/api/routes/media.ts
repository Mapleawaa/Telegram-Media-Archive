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
import { z } from 'zod';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import {
  mediaAnnotation,
  mediaAsset,
  mediaTag,
  telegramMessage,
} from '../../database/schema.js';
import { reparseAsset } from '../../metadata/reparse.js';
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

  /**
   * 设为主源（P5-1 / B6）：决定详情页展示、缩略图与转发的默认来源。
   * 一个资产只有一条 is_primary；切换是原子操作。
   */
  app.post('/api/media/:id/primary', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const body = z.object({ messageId: z.coerce.number().int() }).parse(req.body ?? {});

    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'not_found' });
    const target = ctx.db
      .select()
      .from(telegramMessage)
      .where(and(eq(telegramMessage.mediaAssetId, id), eq(telegramMessage.id, body.messageId)))
      .get();
    if (!target) return reply.status(404).send({ error: 'source_not_found' });

    ctx.sqlite.transaction(() => {
      ctx.db
        .update(telegramMessage)
        .set({ isPrimary: false })
        .where(eq(telegramMessage.mediaAssetId, id))
        .run();
      ctx.db
        .update(telegramMessage)
        .set({ isPrimary: true })
        .where(eq(telegramMessage.id, body.messageId))
        .run();
      ctx.db
        .update(mediaAsset)
        .set({ preferredMessageId: body.messageId, updatedAt: new Date() })
        .where(eq(mediaAsset.id, id))
        .run();
    })();

    rebuildSearchDoc(ctx, id);
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'primary_changed' }, 'user');
    return { ok: true, mediaId: id, primaryMessageId: body.messageId };
  });

  /**
   * 手动改标题（P5-1 / B6）：写 canonical_title 并锁定（title_source='user'）。
   * 之后规则重解析与 AI 富化都不得覆盖——人工决定优先。
   */
  app.patch('/api/media/:id/title', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const body = z.object({ title: z.string().trim().min(1).max(200) }).parse(req.body ?? {});
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'not_found' });

    ctx.db
      .update(mediaAsset)
      .set({ canonicalTitle: body.title, titleSource: 'user', updatedAt: new Date() })
      .where(eq(mediaAsset.id, id))
      .run();
    rebuildSearchDoc(ctx, id);
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'title_changed' }, 'user');
    return { ok: true, mediaId: id, title: body.title };
  });

  /**
   * 软删除（P5-1 / B6）：列表/分类夹/统计不再出现，作业被撤掉；
   * **不做物理删除**——Telegram 才是事实源，本地记录只是派生数据。
   */
  app.post('/api/media/:id/delete', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'not_found' });
    if (asset.deletedAt) return { ok: true, mediaId: id, alreadyDeleted: true };

    ctx.queue.cancelForMedia(id, '媒体已软删除');
    ctx.db
      .update(mediaAsset)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(mediaAsset.id, id))
      .run();
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'deleted' }, 'user');
    return { ok: true, mediaId: id, deleted: true };
  });

  /** 恢复软删除的媒体 */
  app.post('/api/media/:id/restore', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) return reply.status(404).send({ error: 'not_found' });

    ctx.db
      .update(mediaAsset)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(mediaAsset.id, id))
      .run();
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'restored' }, 'user');
    return { ok: true, mediaId: id, restored: true };
  });

  /** 重新解析（P5-2 / B9）：单条重跑确定性规则（不碰 AI 产物） */
  app.post('/api/media/:id/reparse', async (req, reply) => {
    const id = parseId(req.params);
    if (id === null) return reply.status(400).send({ error: 'invalid_id' });
    const result = reparseAsset(ctx, id);
    if (!result.ok) return reply.status(400).send({ error: 'reparse_skipped', message: result.reason });
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'reparsed' }, 'user');
    return { ok: true, mediaId: id, changed: result.changed, titleChanged: result.titleChanged };
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

    // 选源（P5-3 / B13）：多来源时允许指定要转发的来源；缺省用主源
    const source = body.sourceMessageId
      ? (detail.sources.find((s) => s.id === body.sourceMessageId) ??
        detail.sources.find((s) => s.isPrimary) ??
        detail.sources[0])
      : (detail.sources.find((s) => s.isPrimary) ?? detail.sources[0]);
    if (!source) {
      await reply.status(404).send({ error: 'no_source', message: '该媒体没有 Telegram 来源消息' });
      return;
    }

    // 相册整组转发（P5-3 / B13）：按组内时间顺序逐条发送
    if (body.album) {
      const groupId = ctx.sqlite
        .prepare(`SELECT media_group_id AS g FROM telegram_message WHERE id = ?`)
        .get(source.id) as { g: string | null } | undefined;
      if (!groupId?.g) {
        await reply
          .status(400)
          .send({ error: 'not_album', message: '这条媒体不在相册组里，无法整组转发' });
        return;
      }
      const members = ctx.sqlite
        .prepare(
          `SELECT a.id AS mediaId, tm.chat_id AS chatId, tm.message_id AS messageId
           FROM telegram_message tm
           JOIN media_asset a ON a.id = tm.media_asset_id
           WHERE tm.media_group_id = ? AND a.deleted_at IS NULL
           ORDER BY tm.message_date ASC, tm.id ASC`,
        )
        .all(groupId.g) as { mediaId: number; chatId: number; messageId: number }[];

      const items: { mediaId: number; chatId: number; messageId: number }[] = [];
      for (const m of members) {
        const r = await deps.tg.sendMedia(
          { chatId: m.chatId, messageId: m.messageId },
          targetChatId,
          mode,
        );
        items.push({ mediaId: m.mediaId, chatId: r.chatId, messageId: r.messageId });
        ctx.bus.emit(
          'telegram.message.forwarded',
          { mediaId: m.mediaId, chatId: r.chatId, messageId: r.messageId, mode, album: true },
          'user',
        );
      }
      return { ok: true, chatId: targetChatId, messageId: items.at(-1)?.messageId ?? 0, mode, album: true, count: items.length, items };
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
