import { describe, expect, it } from 'vitest';
import { createTestContext } from '../database/test-utils.js';
import { mediaAsset, mediaEmbedding, mediaTag } from '../database/schema.js';
import { ingestMessage } from '../ingestion/ingest.js';
import { ensureVecTable, getVecDim, knnSearch, upsertVector, vectorCount } from '../vector/store.js';
import { buildEmbeddingDoc, embedAsset } from './embedding.js';
import type { IncomingMessage } from '../telegram/types.js';

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    caption: '#测试',
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: 'f1',
      fileUniqueId: 'u1',
      fileName: 'Breaking.Bad.S05E10.2160p.WEB-DL.H.265.mkv',
      mime: 'video/x-matroska',
      size: 1_000_000,
      durationSec: 2700,
      width: 3840,
      height: 2160,
    },
    ...overrides,
  };
}

function makeCtx() {
  return createTestContext({
    AI_PROVIDER: 'mock',
    AI_CHAT_MODEL: 'mock/chat',
    AI_EMBED_MODEL: 'mock/embed',
  } as never);
}

describe('vector store', () => {
  it('upsert + KNN 查询往返', () => {
    const ctx = createTestContext();
    ensureVecTable(ctx.sqlite, 4, ctx.logger);
    upsertVector(ctx.sqlite, 1, [1, 0, 0, 0]);
    upsertVector(ctx.sqlite, 2, [0, 1, 0, 0]);

    const hits = knnSearch(ctx.sqlite, [0.9, 0.1, 0, 0], 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.assetId).toBe(1);
    expect(hits[0]!.distance).toBeLessThan(hits[1]!.distance);
  });

  it('维度变化时重建向量表并清除旧 embedding 记录', () => {
    const ctx = createTestContext();
    const { assetId } = ingestMessage(ctx, makeMsg());

    ensureVecTable(ctx.sqlite, 8, ctx.logger);
    expect(getVecDim(ctx.sqlite)).toBe(8);

    ctx.db
      .insert(mediaEmbedding)
      .values({
        mediaAssetId: assetId,
        kind: 'text',
        model: 'x',
        dim: 8,
        contentHash: 'h',
      })
      .run();

    ensureVecTable(ctx.sqlite, 16, ctx.logger);
    expect(getVecDim(ctx.sqlite)).toBe(16);
    expect(ctx.db.select().from(mediaEmbedding).all()).toHaveLength(0);
    expect(vectorCount(ctx.sqlite)).toBe(0);
  });
});

describe('embedAsset', () => {
  it('首次计算并入库，二次同内容走缓存不重复计费', async () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());

    const first = await embedAsset(ctx, ctx.ai, assetId);
    expect(first.status).toBe('created');
    expect(first.dim).toBeGreaterThan(0);
    expect(vectorCount(ctx.sqlite)).toBe(1);

    const second = await embedAsset(ctx, ctx.ai, assetId);
    expect(second.status).toBe('cached');

    const runs = ctx.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ai_runs WHERE kind = 'embedding'`)
      .get() as { n: number };
    expect(runs.n).toBe(1);
  });

  it('内容变化（新增标签）后内容哈希变化，会重新计算', async () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    await embedAsset(ctx, ctx.ai, assetId);

    const before = buildEmbeddingDoc(ctx, assetId)!;
    ctx.db.insert(mediaTag).values({ mediaAssetId: assetId, tag: '收藏', source: 'user' }).run();
    const after = buildEmbeddingDoc(ctx, assetId)!;
    expect(after.hash).not.toBe(before.hash);

    const again = await embedAsset(ctx, ctx.ai, assetId);
    expect(again.status).toBe('created');

    const runs = ctx.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ai_runs WHERE kind = 'embedding'`)
      .get() as { n: number };
    expect(runs.n).toBe(2);
  });

  it('归档时若富化未启用但向量能力可用，直接入队 embedding.create', () => {
    const ctx = createTestContext({
      AI_PROVIDER: 'mock',
      AI_EMBED_MODEL: 'mock/embed',
    } as never);
    ingestMessage(ctx, makeMsg());
    const job = ctx.sqlite
      .prepare(`SELECT type FROM jobs WHERE type = 'embedding.create'`)
      .get() as { type: string } | undefined;
    expect(job?.type).toBe('embedding.create');
    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiStatus).toBe('pending');
  });
});
