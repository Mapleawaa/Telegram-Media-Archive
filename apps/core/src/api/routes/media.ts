import fs from 'node:fs';
import {
  AnnotateRequestSchema,
  ForwardRequestSchema,
  MediaListQuerySchema,
  SETTING_KEYS,
  TagRequestSchema,
  type ForwardResponse,
  type MediaDetail,
  type MediaListItem,
  type Page,
} from '@tma/shared';
import { and, eq } from 'drizzle-orm';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import { mediaAnnotation, mediaTag } from '../../database/schema.js';
import { getMediaDetail, queryMedia } from '../../media/queries.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';
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
      order: 'recent',
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
