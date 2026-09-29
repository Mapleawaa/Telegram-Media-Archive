/**
 * P2 AI 介入分流器的 API 层单测：classify / ai-policy / tags:top / sources:forward。
 * 用 Fastify inject，不占端口。
 */
import { SETTING_KEYS } from '@tma/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../server.js';
import { createTestContext } from '../../database/test-utils.js';
import type { AppContext } from '../../context.js';
import { auditEvents, mediaAsset, mediaTag, telegramMessage } from '../../database/schema.js';
import { ingestMessage } from '../../ingestion/ingest.js';
import { setSetting } from '../../settings/store.js';
import type { TelegramClient } from '../../telegram/client.js';
import type { IncomingMessage } from '../../telegram/types.js';

const fakeTg: TelegramClient = {
  kind: 'bot',
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  sendMedia: () => Promise.resolve({ chatId: 1, messageId: 1 }),
  downloadFile: () => Promise.resolve(),
};

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: 'f1',
      fileUniqueId: 'u1',
      fileName: 'secret.S01E01.1080p.mkv',
      size: 1000,
    },
    ...overrides,
  };
}

let ctx: AppContext;
let app: Awaited<ReturnType<typeof createServer>>;

beforeEach(async () => {
  ctx = createTestContext({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat' } as never);
  app = await createServer(ctx, { tg: fakeTg });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/media/:id/classify', () => {
  it('写 user 标签 + 分类 + 敏感标记，状态收尾为 skipped', async () => {
    const { assetId } = ingestMessage(ctx, makeMsg());
    const res = await app.inject({
      method: 'POST',
      url: `/api/media/${assetId}/classify`,
      payload: { tags: ['  Cos ', 'cos', '异环'], category: 'adult', sensitive: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; tagsAdded: number; category: string };
    expect(body.ok).toBe(true);
    // '  Cos ' 与 'cos' 归一化后同标签，去重后新增 2 个
    expect(body.tagsAdded).toBe(2);

    const tags = ctx.db.select().from(mediaTag).all().filter((t) => t.source === 'user');
    expect(tags.map((t) => t.tag).sort()).toEqual(['cos', '异环']);

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiStatus).toBe('skipped');
    expect(asset.category).toBe('adult');
    expect(asset.categorySource).toBe('user');
    expect(asset.isSensitive).toBe(true);

    expect(ctx.db.select().from(auditEvents).all().map((a) => a.event)).toContain('media.classified');
  });

  it('缺省 category / sensitive 时沿用已有值', async () => {
    const { assetId } = ingestMessage(ctx, makeMsg());
    await app.inject({
      method: 'POST',
      url: `/api/media/${assetId}/classify`,
      payload: { tags: ['a'], category: 'anime' },
    });
    await app.inject({ method: 'POST', url: `/api/media/${assetId}/classify`, payload: { tags: [] } });

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.category).toBe('anime');
    expect(asset.categorySource).toBe('user');
  });

  it('媒体不存在 → 404；body 非法 → 400', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/media/9999/classify', payload: { tags: [] } }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/media/1/classify',
          payload: { tags: 'not-array' },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('POST /api/media/:id/ai-policy', () => {
  it('skip=true：撤销 AI 任务、置 manual', async () => {
    const { assetId } = ingestMessage(
      ctx,
      makeMsg({ forward: { originType: 'channel', chatId: -100111, chatTitle: '某个频道' } }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/media/${assetId}/ai-policy`,
      payload: { skip: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { aiStatus: string; cancelledJobs: number };
    expect(body.aiStatus).toBe('manual');
    expect(body.cancelledJobs).toBe(1);

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiSkip).toBe(true);
    expect(asset.aiStatus).toBe('manual');
    const pending = ctx.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'`)
      .get() as { n: number };
    expect(pending.n).toBe(0);
  });

  it('skip=false：重新入队 ai.enrich 并回到 pending', async () => {
    const { assetId } = ingestMessage(ctx, makeMsg());
    await app.inject({
      method: 'POST',
      url: `/api/media/${assetId}/ai-policy`,
      payload: { skip: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/media/${assetId}/ai-policy`,
      payload: { skip: false },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { aiStatus: string; jobId: number | null };
    expect(body.aiStatus).toBe('pending');
    expect(body.jobId).toBeGreaterThan(0);

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiSkip).toBe(false);
    expect(asset.aiStatus).toBe('pending');
  });
});

describe('GET /api/tags/top', () => {
  it('按来源聚合标签计数（默认 user）', async () => {
    const a = ingestMessage(ctx, makeMsg({ messageId: 1 }));
    const b = ingestMessage(
      ctx,
      makeMsg({
        messageId: 2,
        media: {
          ...makeMsg().media,
          fileId: 'f2',
          fileUniqueId: 'u2',
          fileName: 'other.S02E03.1080p.mkv',
        },
      }),
    );
    expect(b.assetId).not.toBe(a.assetId);
    for (const id of [a.assetId, b.assetId]) {
      ctx.db.insert(mediaTag).values({ mediaAssetId: id, tag: 'cos', source: 'user' }).run();
    }

    const res = await app.inject({ method: 'GET', url: '/api/tags/top?source=user&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: { tag: string; count: number }[] };
    expect(body.items[0]).toEqual({ tag: 'cos', count: 2 });
  });
});

describe('GET /api/sources/forward', () => {
  it('聚合观察到的来源并回显跳过列表', async () => {
    ingestMessage(
      ctx,
      makeMsg({ messageId: 1, forward: { originType: 'channel', chatId: -100111, chatTitle: '资源频道' } }),
    );
    ingestMessage(
      ctx,
      makeMsg({
        messageId: 2,
        media: { ...makeMsg().media, fileId: 'f2', fileUniqueId: 'u2' },
        forward: { originType: 'user', senderUserId: 4242, senderName: 'Ada' },
      }),
    );
    ingestMessage(
      ctx,
      makeMsg({
        messageId: 3,
        media: { ...makeMsg().media, fileId: 'f3', fileUniqueId: 'u3' },
        forward: { originType: 'hidden_user', senderName: '匿名君' },
      }),
    );
    setSetting(ctx, SETTING_KEYS.aiSkipSources, ['channel:-100111']);
    await app.inject({
      method: 'POST',
      url: `/api/media/1/ai-policy`,
      payload: { skip: true },
    });

    const res = await app.inject({ method: 'GET', url: '/api/sources/forward' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      items: { key: string; type: string; chatId: number | null; skippedCount: number }[];
      skipSources: string[];
    };
    expect(body.items.map((i) => i.key).sort()).toEqual(['channel:-100111', 'name:匿名君', 'user:4242']);
    const channel = body.items.find((i) => i.key === 'channel:-100111')!;
    expect(channel.type).toBe('channel');
    expect(channel.chatId).toBe(-100111);
    expect(channel.skippedCount).toBe(1);
    expect(body.skipSources).toEqual(['channel:-100111']);
  });

  it('无转发来源时返回空列表', async () => {
    ingestMessage(ctx, makeMsg());
    const res = await app.inject({ method: 'GET', url: '/api/sources/forward' });
    const body = JSON.parse(res.body) as { items: unknown[] };
    expect(body.items).toEqual([]);
    expect(ctx.db.select().from(telegramMessage).all()).toHaveLength(1);
  });
});
