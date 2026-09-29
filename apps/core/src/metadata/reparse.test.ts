import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext } from '../database/test-utils.js';
import { mediaAsset, mediaMetadata } from '../database/schema.js';
import { ingestMessage } from '../ingestion/ingest.js';
import type { IncomingMessage } from '../telegram/types.js';
import { reparseAsset } from './reparse.js';

function msg(partial: Partial<IncomingMessage> & { media: IncomingMessage['media'] }): IncomingMessage {
  return {
    chatId: -1002464626889,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageDate: Date.now(),
    ...partial,
  };
}

function seed(fileName: string) {
  const ctx = createTestContext();
  const r = ingestMessage(
    ctx,
    msg({
      messageId: 10,
      media: { kind: 'video', fileId: 'v10', fileUniqueId: 'vu10', fileName, size: 1000 },
    }),
  );
  return { ctx, assetId: r.assetId };
}

describe('reparseAsset（P5-2 规则重解析）', () => {
  it('幂等：规则没变时重解析不产生变化', () => {
    const { ctx, assetId } = seed('Show.S01E02.1080p.WEB-DL.mkv');
    const r = reparseAsset(ctx, assetId);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.titleChanged).toBe(false);
  });

  it('文件名变了（规则输入变了）→ 季集/标题跟着更新', () => {
    const { ctx, assetId } = seed('Show.S01E02.1080p.WEB-DL.mkv');
    const before = ctx.db
      .select()
      .from(mediaMetadata)
      .where(eq(mediaMetadata.mediaAssetId, assetId))
      .get()!;
    expect(before.season).toBe(1);
    expect(before.episode).toBe(2);

    // 模拟「事实源变了」：重解析的意义是让派生数据跟上
    ctx.db
      .update(mediaMetadata)
      .set({ fileName: 'Narcos.S02E05.2160p.WEB-DL.mkv' })
      .where(eq(mediaMetadata.mediaAssetId, assetId))
      .run();

    const r = reparseAsset(ctx, assetId);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.titleChanged).toBe(true);

    const meta = ctx.db
      .select()
      .from(mediaMetadata)
      .where(eq(mediaMetadata.mediaAssetId, assetId))
      .get()!;
    expect(meta.season).toBe(2);
    expect(meta.episode).toBe(5);

    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get()!;
    expect(asset.canonicalTitle).toBe(meta.titleNorm);
    expect(asset.titleSource).toBe('rule');
  });

  it('用户手动改过标题（title_source=user）→ 重解析不覆盖', () => {
    const { ctx, assetId } = seed('Show.S01E02.1080p.WEB-DL.mkv');
    ctx.db
      .update(mediaAsset)
      .set({ canonicalTitle: '我的剧 第一季', titleSource: 'user' })
      .where(eq(mediaAsset.id, assetId))
      .run();

    ctx.db
      .update(mediaMetadata)
      .set({ fileName: 'Narcos.S02E05.2160p.WEB-DL.mkv' })
      .where(eq(mediaMetadata.mediaAssetId, assetId))
      .run();

    const r = reparseAsset(ctx, assetId);
    expect(r.ok).toBe(true);
    // 规则字段（季集）照常更新
    expect(
      ctx.db.select().from(mediaMetadata).where(eq(mediaMetadata.mediaAssetId, assetId)).get()!.season,
    ).toBe(2);
    // 但标题纹丝不动
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get()!;
    expect(asset.canonicalTitle).toBe('我的剧 第一季');
    expect(r.titleChanged).toBe(false);
  });

  it('软删除的媒体跳过重解析', () => {
    const { ctx, assetId } = seed('Show.S01E02.1080p.WEB-DL.mkv');
    ctx.db.update(mediaAsset).set({ deletedAt: new Date() }).where(eq(mediaAsset.id, assetId)).run();
    const r = reparseAsset(ctx, assetId);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('已删除');
  });
});
