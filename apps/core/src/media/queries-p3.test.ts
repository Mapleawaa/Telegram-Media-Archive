/**
 * P3 列表查询层：分类筛选 / 相册聚簇字段 / 排序。
 * 契约要点：`albumCount` 1 = 非相册或单条相册，>1 才显示角标。
 */
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../database/test-utils.js';
import { ingestMessage } from '../ingestion/ingest.js';
import type { IncomingMessage } from '../telegram/types.js';
import { queryMedia } from './queries.js';

function photo(overrides: { messageId: number; uid: string; group: string | null; size?: number }): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId: overrides.messageId,
    chatType: 'supergroup',
    chatTitle: '归档群',
    mediaGroupId: overrides.group ?? undefined,
    messageDate: Date.now(),
    media: {
      kind: 'photo',
      fileId: `f${overrides.uid}`,
      fileUniqueId: overrides.uid,
      width: 1200,
      height: 1600,
      size: overrides.size ?? 100_000,
    },
  };
}

function video(messageId: number, uid: string, size: number, fileName: string): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: `f${uid}`,
      fileUniqueId: uid,
      fileName,
      size,
      durationSec: 1200,
    },
  };
}

function seed() {
  const ctx = createTestContext();
  // 相册组（2 条）+ 单张图 + 一条视频
  ingestMessage(ctx, photo({ messageId: 1, uid: 'a1', group: 'grp-1', size: 111 }));
  ingestMessage(ctx, photo({ messageId: 2, uid: 'a2', group: 'grp-1', size: 222 }));
  ingestMessage(ctx, photo({ messageId: 3, uid: 'b1', group: null, size: 333 }));
  ingestMessage(ctx, video(4, 'v1', 9999, 'Movie.2024.1080p.mkv'));
  return ctx;
}

describe('queryMedia: P3 分类 / 相册 / 排序', () => {
  it('按分类过滤', () => {
    const ctx = seed();
    const gallery = queryMedia(ctx.sqlite, {
      filters: { category: 'gallery' },
      limit: 50,
      order: 'recent',
    });
    expect(gallery.items).toHaveLength(3);
    expect(gallery.items.every((i) => i.category === 'gallery')).toBe(true);

    const other = queryMedia(ctx.sqlite, { filters: { category: 'other' }, limit: 50, order: 'recent' });
    expect(other.items.map((i) => i.type)).toEqual(['video']);
  });

  it('albumCount：同组 2 条 → 2；非相册 → 1', () => {
    const ctx = seed();
    const page = queryMedia(ctx.sqlite, { filters: {}, limit: 50, order: 'recent' });
    const byGroup = new Map(page.items.map((i) => [i.mediaGroupId, i.albumCount]));

    const albumItems = page.items.filter((i) => i.mediaGroupId === 'grp-1');
    expect(albumItems).toHaveLength(2);
    expect(albumItems.every((i) => i.albumCount === 2)).toBe(true);

    // 非相册（media_group_id IS NULL）必须是 1，而不是 0
    expect(page.items.filter((i) => i.mediaGroupId === null).every((i) => i.albumCount === 1)).toBe(true);
    expect(byGroup.get(null)).toBe(1);
  });

  it('未分类过滤：category IS NULL 用 __none__', () => {
    const ctx = seed();
    // 全部已由规则回填分类 → 未分类应为空
    const none = queryMedia(ctx.sqlite, { filters: { category: '__none__' }, limit: 50, order: 'recent' });
    expect(none.items).toHaveLength(0);
  });

  it('排序：size 降序', () => {
    const ctx = seed();
    const bySize = queryMedia(ctx.sqlite, { filters: {}, limit: 50, order: 'size' });
    const sizes = bySize.items.map((i) => i.sizeBytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(bySize.items[0]!.type).toBe('video');
  });

  it('只有 recent 返回 keyset 游标，其它排序不带游标', () => {
    const ctx = seed();
    const recent = queryMedia(ctx.sqlite, { filters: {}, limit: 2, order: 'recent' });
    expect(recent.nextCursor).not.toBeNull();
    const bySize = queryMedia(ctx.sqlite, { filters: {}, limit: 2, order: 'size' });
    expect(bySize.nextCursor).toBeNull();
  });
});
