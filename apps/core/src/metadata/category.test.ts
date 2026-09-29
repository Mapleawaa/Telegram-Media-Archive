import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext } from '../database/test-utils.js';
import { mediaAsset, mediaTag } from '../database/schema.js';
import { ingestMessage } from '../ingestion/ingest.js';
import type { IncomingMessage } from '../telegram/types.js';
import {
  applyDerivedCategory,
  backfillRuleCategory,
  deriveRuleCategory,
  looksAdult,
  normalizeCategory,
} from './category.js';

function msg(
  partial: Partial<IncomingMessage> & { media: IncomingMessage['media'] },
): IncomingMessage {
  return {
    chatId: -1000000000000,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageDate: Date.now(),
    ...partial,
  };
}

const PHOTO = msg({
  messageId: 11,
  media: { kind: 'photo', fileId: 'p1', fileUniqueId: 'pu1', width: 1280, height: 720, size: 1000 },
});

const SERIES = msg({
  messageId: 12,
  media: {
    kind: 'video',
    fileId: 'v1',
    fileUniqueId: 'vu1',
    fileName: 'Breaking.Bad.S05E10.2160p.WEB-DL.mkv',
    size: 2_000_000,
  },
});

const PLAIN_VIDEO = msg({
  messageId: 13,
  media: {
    kind: 'video',
    fileId: 'v2',
    fileUniqueId: 'vu2',
    fileName: 'holiday-clip.mp4',
    size: 1_000_000,
  },
});

describe('normalizeCategory', () => {
  it('预设与中文别名归一', () => {
    expect(normalizeCategory('Anime')).toBe('anime');
    expect(normalizeCategory('动漫')).toBe('anime');
    expect(normalizeCategory('电视剧')).toBe('series');
    expect(normalizeCategory('成人')).toBe('adult');
    expect(normalizeCategory('图集')).toBe('gallery');
    expect(normalizeCategory('NSFW')).toBe('adult');
    expect(normalizeCategory('movie')).toBe('movie');
  });

  it('自定义分类原样保留（截断 32），空值返回 null', () => {
    expect(normalizeCategory('纪录片')).toBe('纪录片');
    expect(normalizeCategory('  ')).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory('x'.repeat(80))!.length).toBe(32);
  });
});

describe('deriveRuleCategory', () => {
  it('图片 → gallery', () => {
    expect(deriveRuleCategory({ type: 'photo', season: null, mediaGroupId: 'album-1' }).category).toBe('gallery');
    expect(deriveRuleCategory({ type: 'photo', season: null, mediaGroupId: null }).category).toBe('gallery');
  });

  it('季集 → series', () => {
    expect(deriveRuleCategory({ type: 'video', season: 5, mediaGroupId: null }).category).toBe('series');
  });

  it('无明确规则的视频 → 兜底 other（六类全覆盖）', () => {
    expect(deriveRuleCategory({ type: 'video', season: null, mediaGroupId: null }).category).toBe('other');
  });

  it('成人关键词标签 → 建议敏感', () => {
    expect(deriveRuleCategory({ type: 'video', season: null, mediaGroupId: null, tags: ['成人向'] }).sensitive).toBe(true);
    expect(deriveRuleCategory({ type: 'video', season: null, mediaGroupId: null, tags: ['cosplay'] }).sensitive).toBe(false);
    expect(looksAdult('R18 写真')).toBe(true);
    expect(looksAdult('风景')).toBe(false);
  });
});

describe('applyDerivedCategory（优先级 user > llm > rule）', () => {
  it('新建 asset：规则先落库（图片 → gallery）', () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, PHOTO);
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, r.assetId)).get()!;
    expect(asset.category).toBe('gallery');
    expect(asset.categorySource).toBe('rule');
  });

  it('季集视频：规则落 series', () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, SERIES);
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, r.assetId)).get()!;
    expect(asset.category).toBe('series');
    expect(asset.categorySource).toBe('rule');
  });

  it('AI 强分类覆盖规则（llm > rule）', () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, SERIES);
    const res = applyDerivedCategory(ctx, r.assetId, 'movie');
    expect(res.category).toBe('movie');
    expect(res.categorySource).toBe('llm');
  });

  it("AI 的 'other'（没把握）不覆盖确定性规则", () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, SERIES);
    const res = applyDerivedCategory(ctx, r.assetId, 'other');
    expect(res.category).toBe('series');
    expect(res.categorySource).toBe('rule');
  });

  it('用户已接管（categorySource=user）→ 规则与 AI 都不动', () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, PHOTO);
    ctx.db
      .update(mediaAsset)
      .set({ category: 'other', categorySource: 'user', isSensitive: true })
      .where(eq(mediaAsset.id, r.assetId))
      .run();
    const res = applyDerivedCategory(ctx, r.assetId, 'movie');
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, r.assetId)).get()!;
    expect(res.category).toBe('other');
    expect(asset.category).toBe('other');
    expect(asset.isSensitive).toBe(true);
  });

  it('成人标签 → 自动置敏感', () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, PLAIN_VIDEO);
    ctx.db
      .insert(mediaTag)
      .values({ mediaAssetId: r.assetId, tag: '成人向', source: 'llm' })
      .run();
    const res = applyDerivedCategory(ctx, r.assetId, null);
    expect(res.sensitive).toBe(true);
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, r.assetId)).get()!;
    expect(asset.isSensitive).toBe(true);
  });
});

describe('backfillRuleCategory（reindex 回填：只补空缺）', () => {
  it('填空缺，但不覆盖 llm/user', () => {
    const ctx = createTestContext();
    const r = ingestMessage(ctx, PHOTO);
    // 模拟历史数据：清掉分类
    ctx.db.update(mediaAsset).set({ category: null, categorySource: null }).where(eq(mediaAsset.id, r.assetId)).run();
    expect(backfillRuleCategory(ctx, r.assetId)).toBe(true);
    expect(ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, r.assetId)).get()!.category).toBe('gallery');

    // llm 已赋值 → 不回填
    ctx.db.update(mediaAsset).set({ category: 'movie', categorySource: 'llm' }).where(eq(mediaAsset.id, r.assetId)).run();
    expect(backfillRuleCategory(ctx, r.assetId)).toBe(false);
    expect(ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, r.assetId)).get()!.category).toBe('movie');
  });
});
