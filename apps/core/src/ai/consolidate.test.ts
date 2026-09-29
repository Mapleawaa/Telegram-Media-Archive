import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AiGateway } from './gateway.js';
import { buildConsolidatePrompt, consolidateTags } from './consolidate.js';
import { createTestContext } from '../database/test-utils.js';
import { mediaAsset, mediaTag } from '../database/schema.js';
import { ingestMessage } from '../ingestion/ingest.js';
import type { IncomingMessage } from '../telegram/types.js';

function msg(partial: Partial<IncomingMessage> & { media: IncomingMessage['media'] }): IncomingMessage {
  return {
    chatId: -1000000000000,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageDate: Date.now(),
    ...partial,
  };
}

/** 只实现 consolidateTags 用到的最小面：chatEnabled / withRun / runChat / recordStep */
function stubGateway(reply: unknown): AiGateway & { steps: { toolName?: string }[] } {
  const steps: { toolName?: string }[] = [];
  return {
    steps,
    chatEnabled: true,
    withRun: async <T>(_kind: string, _req: string | undefined, fn: (id: number) => Promise<T>) => fn(1),
    runChat: async () => ({ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }),
    recordStep: (_runId: number, step: { toolName?: string }) => {
      steps.push(step);
    },
  } as unknown as AiGateway & { steps: { toolName?: string }[] };
}

function seedAsset(ctx: ReturnType<typeof createTestContext>) {
  const r = ingestMessage(
    ctx,
    msg({
      messageId: 21,
      media: {
        kind: 'video',
        fileId: 'v21',
        fileUniqueId: 'vu21',
        fileName: 'clip.mp4',
        size: 1000,
      },
    }),
  );
  const add = (tag: string, source: 'llm' | 'vision' | 'user') =>
    ctx.db.insert(mediaTag).values({ mediaAssetId: r.assetId, tag, source }).onConflictDoNothing().run();
  add('cos', 'llm');
  add('测试标签', 'llm');
  add('收藏', 'user');
  add('保留项', 'user');
  return r.assetId;
}

const tagsOf = (ctx: ReturnType<typeof createTestContext>, id: number) =>
  ctx.db
    .select()
    .from(mediaTag)
    .where(eq(mediaTag.mediaAssetId, id))
    .all()
    .map((r) => `${r.tag}:${r.source}`)
    .sort();

describe('buildConsolidatePrompt', () => {
  it('只喂标签列表，明确不看内容', () => {
    const p = buildConsolidatePrompt(['cos', 'cosplay']);
    expect(p).toContain('不要推测媒体内容');
    expect(p).toContain('cos、cosplay');
  });

  it('明确禁止把推理写进正文（真实缺陷：9/25 次推理占满 token，没吐 JSON）', () => {
    const p = buildConsolidatePrompt(['cos']);
    expect(p).toContain('不要输出任何思考过程');
    expect(p).toContain('第一个字符必须是 {');
  });
});

describe('consolidateTags', () => {
  it('merge 归并 + drop 删除非 user 标签；user 标签原样保留', () => {
    const ctx = createTestContext();
    const id = seedAsset(ctx);
    const gateway = stubGateway({
      keep: ['cosplay', '收藏'],
      drop: ['测试标签', '保留项'],
      merge: { cos: 'cosplay', 收藏: '收藏夹' },
      category: 'anime',
    });

    return consolidateTags(ctx, gateway, id).then((res) => {
      const after = tagsOf(ctx, id);
      // cos → cosplay（llm）；测试标签被删；两个 user 标签纹丝不动（含被要求 drop/merge 的）
      expect(after).toContain('cosplay:llm');
      expect(after).not.toContain('cos:llm');
      expect(after).not.toContain('测试标签:llm');
      expect(after).toContain('收藏:user');
      expect(after).toContain('保留项:user');
      expect(res.merged).toEqual({ cos: 'cosplay' });
      expect(res.dropped).toContain('测试标签');

      // 分类落库（llm）
      const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get()!;
      expect(asset.category).toBe('anime');
      expect(asset.categorySource).toBe('llm');
    });
  });

  it('user 已接管分类 → 标签仍可治理，但分类不被改', () => {
    const ctx = createTestContext();
    const id = seedAsset(ctx);
    ctx.db.update(mediaAsset).set({ category: 'other', categorySource: 'user' }).where(eq(mediaAsset.id, id)).run();
    const gateway = stubGateway({ keep: [], drop: ['测试标签'], merge: {}, category: 'movie' });

    return consolidateTags(ctx, gateway, id).then(() => {
      const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get()!;
      expect(asset.category).toBe('other');
      expect(asset.categorySource).toBe('user');
    });
  });

  it('模型返回非 JSON → 不改动标签、留 decision 痕迹、并抛错交给队列重试', async () => {
    const ctx = createTestContext();
    const id = seedAsset(ctx);
    const before = tagsOf(ctx, id);
    const gateway = stubGateway('我们需要处理这些标签，先分析一下…');

    await expect(consolidateTags(ctx, gateway, id)).rejects.toThrow(/未返回可解析 JSON/);

    // 关键 1：标签一个都不能动
    expect(tagsOf(ctx, id)).toEqual(before);
    // 关键 2：不能静默 no-op —— 真机曾有 9/25 条「跑完等于没跑」且无痕迹
    expect(gateway.steps.map((s) => s.toolName)).toContain('tags.consolidate.unusable');
  });

  it('chat 未启用 → 直接返回空结果（不调模型）', () => {
    const ctx = createTestContext();
    const id = seedAsset(ctx);
    const before = tagsOf(ctx, id);
    const gateway = { chatEnabled: false } as unknown as AiGateway;
    return consolidateTags(ctx, gateway, id).then((res) => {
      expect(tagsOf(ctx, id)).toEqual(before);
      expect(res.kept).toBe(0);
    });
  });
});
