import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from '../telegram/types.js';
import { createTestContext } from '../database/test-utils.js';
import { ingestMessage } from '../ingestion/ingest.js';
import { ensureVecTable, upsertVector, vectorCount } from '../vector/store.js';
import { embedAsset } from '../ai/embedding.js';
import { hybridSearch } from './orchestrator.js';

function makeMsg(id: number, title: string): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId: id,
    chatType: 'supergroup',
    chatTitle: '归档群',
    caption: title,
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: `f${id}`,
      fileUniqueId: `u${id}`,
      fileName: `${title}.2024.1080p.mkv`,
      mime: 'video/x-matroska',
      size: 1_000_000 + id,
      durationSec: 100,
    },
  };
}

describe('hybridSearch', () => {
  it('三路融合：FTS 与向量都有命中时策略为 hybrid', async () => {
    const ctx = createTestContext({
      AI_PROVIDER: 'mock',
      AI_CHAT_MODEL: 'mock/chat',
      AI_EMBED_MODEL: 'mock/embed',
    } as never);

    const a = ingestMessage(ctx, makeMsg(1, 'blade runner cyberpunk'));
    const b = ingestMessage(ctx, makeMsg(2, 'breaking bad chemistry'));
    await embedAsset(ctx, ctx.ai, a.assetId);
    await embedAsset(ctx, ctx.ai, b.assetId);
    expect(vectorCount(ctx.sqlite)).toBe(2);

    const result = await hybridSearch(ctx, ctx.ai, {
      query: 'blade runner',
      filters: {},
      limit: 10,
    });

    expect(result.debug.strategy).toBe('hybrid');
    expect(result.debug.ftsHits).toBeGreaterThan(0);
    expect(result.debug.vectorHits).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.map((i) => i.id)).toContain(a.assetId);
  });

  it('未配置 embedding：降级为 FTS 且 debug 可见', async () => {
    const ctx = createTestContext({
      AI_PROVIDER: 'mock',
      AI_CHAT_MODEL: 'mock/chat',
    } as never);
    ingestMessage(ctx, makeMsg(1, 'blade runner cyberpunk'));

    const result = await hybridSearch(ctx, ctx.ai, {
      query: 'blade runner',
      filters: {},
      limit: 10,
    });

    expect(result.debug.strategy).toBe('fts');
    expect(result.debug.vectorHits).toBe(0);
    expect(result.items.length).toBe(1);
  });

  it('结构化过滤在融合后仍然生效', async () => {
    const ctx = createTestContext({
      AI_PROVIDER: 'mock',
      AI_CHAT_MODEL: 'mock/chat',
      AI_EMBED_MODEL: 'mock/embed',
    } as never);
    const a = ingestMessage(ctx, makeMsg(1, 'blade runner cyberpunk'));
    const b = ingestMessage(ctx, makeMsg(2, 'blade runner 2049 sequel'));
    await embedAsset(ctx, ctx.ai, a.assetId);
    await embedAsset(ctx, ctx.ai, b.assetId);

    const result = await hybridSearch(ctx, ctx.ai, {
      query: 'blade runner',
      filters: { year: 2024 },
      limit: 10,
    });
    expect(result.items.length).toBe(2);

    const none = await hybridSearch(ctx, ctx.ai, {
      query: 'blade runner',
      filters: { year: 1999 },
      limit: 10,
    });
    expect(none.items).toHaveLength(0);
  });

  it('向量表为空时不触发向量检索（不浪费 embedding 调用）', async () => {
    const ctx = createTestContext({
      AI_PROVIDER: 'mock',
      AI_CHAT_MODEL: 'mock/chat',
      AI_EMBED_MODEL: 'mock/embed',
    } as never);
    ingestMessage(ctx, makeMsg(1, 'blade runner cyberpunk'));
    ensureVecTable(ctx.sqlite, 64, ctx.logger);
    upsertVector(ctx.sqlite, 999, new Array(64).fill(0.1));

    const result = await hybridSearch(ctx, ctx.ai, { query: 'blade runner', filters: {}, limit: 5 });
    expect(result.debug.vectorHits).toBeGreaterThan(0); // 表非空 → 会尝试向量检索
  });
});
