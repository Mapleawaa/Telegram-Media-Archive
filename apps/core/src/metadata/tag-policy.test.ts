import { describe, expect, it } from 'vitest';
import { createTestContext } from '../database/test-utils.js';
import { mediaTag } from '../database/schema.js';
import { ingestMessage } from '../ingestion/ingest.js';
import type { IncomingMessage } from '../telegram/types.js';
import { MAX_TAGS_PER_ASSET, filterTags, isLowValueTag, normalizeTag, pruneAssetTags } from './tag-policy.js';

const NO_CHATS: ReadonlySet<string> = new Set();

describe('normalizeTag', () => {
  it('折叠空白、ASCII 小写、截断', () => {
    expect(normalizeTag('  CosPlay  ')).toBe('cosplay');
    expect(normalizeTag('二次元')).toBe('二次元');
    expect(normalizeTag('a'.repeat(80))!.length).toBe(64);
    expect(normalizeTag('   ')).toBeNull();
  });
});

describe('isLowValueTag', () => {
  it('过滤分辨率/类型词/未命名/纯数字/长随机串', () => {
    for (const tag of ['1280x720', '1080P', 'photo', 'video', '未命名', '2024', 'a1b2c3d4e5f6g7h8i9j0k1l2']) {
      expect(isLowValueTag(tag, NO_CHATS)).toBe(true);
    }
  });

  it('过滤来源群名', () => {
    expect(isLowValueTag('云汐的文件', new Set(['云汐的文件']))).toBe(true);
    expect(isLowValueTag('cosplay', new Set(['云汐的文件']))).toBe(false);
  });

  it('保留正常标签', () => {
    for (const tag of ['二次元', 'cosplay', '赛博朋克', '成人向', '剧集']) {
      expect(isLowValueTag(tag, NO_CHATS)).toBe(false);
    }
  });
});

describe('filterTags', () => {
  it('归一化 + 去重 + 过滤低价值', () => {
    expect(
      filterTags(['Cos', 'cos', '1280x720', '二次元', 'photo', ' 二次元 '], NO_CHATS),
    ).toEqual(['cos', '二次元']);
  });
});

describe('pruneAssetTags', () => {
  function makeCtx() {
    return createTestContext();
  }

  function makeMsg(): IncomingMessage {
    return {
      chatId: -1002464626889,
      messageId: 1,
      chatType: 'supergroup',
      chatTitle: '云汐的文件',
      caption: '#收藏',
      messageDate: Date.now(),
      media: {
        kind: 'video',
        fileId: 'f1',
        fileUniqueId: 'u1',
        fileName: 'Movie.2024.1080p.mkv',
        size: 1000,
      },
    };
  }

  it('删除低价值标签与来源群名，保留正常标签', () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.db.insert(mediaTag).values([
      { mediaAssetId: assetId, tag: 'photo', source: 'llm' },
      { mediaAssetId: assetId, tag: '云汐的文件', source: 'llm' },
      { mediaAssetId: assetId, tag: '1280x720', source: 'vision' },
      { mediaAssetId: assetId, tag: 'cosplay', source: 'vision' },
    ]).run();

    const removed = pruneAssetTags(ctx, assetId);
    expect(removed).toBe(3);
    const remaining = ctx.db.select().from(mediaTag).all().map((t) => t.tag).sort();
    expect(remaining).toEqual(['cosplay', '收藏']);
  });

  it('同标签多来源去重：保留高优先级来源', () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.db.insert(mediaTag).values([
      { mediaAssetId: assetId, tag: 'Cosplay', source: 'vision' },
      { mediaAssetId: assetId, tag: 'cosplay', source: 'llm' },
      { mediaAssetId: assetId, tag: 'cosplay', source: 'user' },
    ]).run();

    pruneAssetTags(ctx, assetId);
    const rows = ctx.db.select().from(mediaTag).all().filter((t) => t.tag.toLowerCase() === 'cosplay');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('user');
  });

  it('超过上限时按优先级截断，user 标签不被删除', () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.db.insert(mediaTag).values({ mediaAssetId: assetId, tag: '我的收藏', source: 'user' }).run();
    const many = Array.from({ length: 12 }, (_, i) => ({
      mediaAssetId: assetId,
      tag: `tag${i}`,
      source: (i % 2 === 0 ? 'llm' : 'vision') as 'llm' | 'vision',
    }));
    ctx.db.insert(mediaTag).values(many).run();

    pruneAssetTags(ctx, assetId);
    const rows = ctx.db.select().from(mediaTag).all();
    expect(rows.length).toBeLessThanOrEqual(MAX_TAGS_PER_ASSET);
    expect(rows.some((t) => t.tag === '我的收藏')).toBe(true);
    expect(rows.some((t) => t.tag === '收藏')).toBe(true); // rule 优先级高于 llm/vision
  });
});
