import { describe, expect, it, vi } from 'vitest';
import { SETTING_KEYS } from '@tma/shared';
import { createTestContext } from '../../database/test-utils.js';
import { ingestMessage } from '../../ingestion/ingest.js';
import { setSetting } from '../../settings/store.js';
import type { IncomingMessage } from '../../telegram/types.js';
import {
  ALBUM_DEBOUNCE_MS,
  ARCHIVE_DEBOUNCE_MS,
  createNotifyService,
  formatAnalyzedNotice,
  formatArchivedNotice,
} from './notify.js';

function makeCtx() {
  const ctx = createTestContext();
  setSetting(ctx, SETTING_KEYS.notifyChatId, 777); // 绑定测试通知目标
  return ctx;
}

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    chatId: -100123,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageId: Math.floor(Math.random() * 1_000_000) + 1,
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: `f-${Math.random()}`,
      fileUniqueId: `u-${Math.random()}`,
      fileName: 'Show.S01E01.1080p.mkv',
      size: 1_000,
      durationSec: 60,
    },
    ...overrides,
  };
}

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('createNotifyService', () => {
  it('未绑定时静默丢弃（不发消息）', async () => {
    const ctx = makeCtx();
    setSetting(ctx, SETTING_KEYS.notifyChatId, 0);
    const sends: string[] = [];
    const notify = createNotifyService(ctx, async (_c, text) => {
      sends.push(text);
    });

    const { assetId } = ingestMessage(ctx, makeMsg());
    notify.onEvent({ event: 'media.created', payload: { mediaId: assetId }, actor: 'bot', ts: Date.now() });
    notify.flushNow();
    await settle(10);
    expect(sends).toHaveLength(0);
    notify.dispose();
  });

  it('media.created → 入库通知（标题 + 分类 + AI 整理中）', async () => {
    const ctx = makeCtx();
    const sends: { chatId: number; text: string }[] = [];
    const notify = createNotifyService(ctx, async (chatId, text) => {
      sends.push({ chatId, text });
    });

    const { assetId } = ingestMessage(ctx, makeMsg());
    // 测试环境未配 AI（ingest 直接标 skipped）；模拟「已入队富化」的线上状态
    ctx.sqlite.prepare(`UPDATE media_asset SET ai_status = 'pending' WHERE id = ?`).run(assetId);
    notify.onEvent({ event: 'media.created', payload: { mediaId: assetId }, actor: 'bot', ts: Date.now() });
    notify.flushNow();
    await settle(10);

    expect(sends).toHaveLength(1);
    expect(sends[0]!.chatId).toBe(777);
    expect(sends[0]!.text).toContain('已归档');
    expect(sends[0]!.text).toContain('AI 整理中');
    notify.dispose();
  });

  it('相册（media_group_id）多条合并成一条通知', async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeCtx();
      const sends: string[] = [];
      const notify = createNotifyService(ctx, async (_c, text) => {
      sends.push(text);
    });

      // 相册成员的 file_unique / 文件名都必须互不相同，否则会被去重合并成一个资产
      const a = ingestMessage(
        ctx,
        makeMsg({ mediaGroupId: 'grp-1', media: { ...makeMsg().media, fileUniqueId: 'ua-1' } }),
      );
      const b = ingestMessage(
        ctx,
        makeMsg({
          mediaGroupId: 'grp-1',
          media: { ...makeMsg().media, fileUniqueId: 'ua-2', fileName: 'Show.S01E02.1080p.mkv' },
        }),
      );
      notify.onEvent({ event: 'media.created', payload: { mediaId: a.assetId }, actor: 'bot', ts: Date.now() });
      notify.onEvent({ event: 'media.created', payload: { mediaId: b.assetId }, actor: 'bot', ts: Date.now() });
      await vi.advanceTimersByTimeAsync(ALBUM_DEBOUNCE_MS + 10);

      expect(sends).toHaveLength(1);
      expect(sends[0]).toContain('相册已归档（2 项）');
      notify.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('media.analyzed → AI 完成通知（新分类 + 标签）', async () => {
    const ctx = makeCtx();
    const sends: string[] = [];
    const notify = createNotifyService(ctx, async (_c, text) => {
      sends.push(text);
    });

    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.sqlite
      .prepare(`UPDATE media_asset SET category = 'series', category_source = 'llm' WHERE id = ?`)
      .run(assetId);
    ctx.sqlite
      .prepare(`INSERT INTO media_tag (media_asset_id, tag, source) VALUES (?, '科幻', 'llm')`)
      .run(assetId);

    notify.onEvent({ event: 'media.analyzed', payload: { mediaId: assetId, status: 'done' }, actor: 'agent', ts: Date.now() });
    notify.flushNow();
    await settle(10);

    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain('AI 整理完成');
    expect(sends[0]).toContain('剧集');
    expect(sends[0]).toContain('科幻');
    notify.dispose();
  });

  it('job.failed 只在最终死亡（dead）时通知，重试中不打扰', async () => {
    const ctx = makeCtx();
    const sends: string[] = [];
    const notify = createNotifyService(ctx, async (_c, text) => {
      sends.push(text);
    });

    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.sqlite
      .prepare(
        `INSERT INTO jobs (type, payload, status, attempts, max_attempts) VALUES ('ai.enrich', ?, 'dead', 3, 3)`,
      )
      .run(JSON.stringify({ mediaId: assetId }));

    // 重试中的失败（status=pending）→ 不通知
    notify.onEvent({ event: 'job.failed', payload: { jobId: 99999, type: 'ai.enrich', error: 'boom' }, actor: 'system', ts: Date.now() });
    notify.flushNow();
    await settle(10);
    expect(sends).toHaveLength(0);

    // dead → 通知
    const dead = ctx.sqlite.prepare(`SELECT id FROM jobs ORDER BY id DESC LIMIT 1`).get() as { id: number };
    notify.onEvent({ event: 'job.failed', payload: { jobId: dead.id, type: 'ai.enrich', error: '配额用尽' }, actor: 'system', ts: Date.now() });
    notify.flushNow();
    await settle(10);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain('AI 整理失败');
    expect(sends[0]).toContain('配额用尽');
    notify.dispose();
  });

  it('去抖常量符合设计（单条 300ms / 相册 2s）', () => {
    expect(ARCHIVE_DEBOUNCE_MS).toBe(300);
    expect(ALBUM_DEBOUNCE_MS).toBe(2000);
  });
});

describe('通知文案', () => {
  const brief = {
    mediaId: 1,
    title: '某影片',
    type: 'video',
    category: 'movie',
    aiStatus: 'pending',
  };

  it('入库通知：相册合并 vs 单条', () => {
    const single = formatArchivedNotice([{ kind: 'archived', brief }], null);
    expect(single).toContain('已归档：某影片');
    expect(single).toContain('分类：电影');

    const album = formatArchivedNotice(
      [{ kind: 'archived', brief: { ...brief, type: 'photo', category: 'gallery' } }],
      8,
    );
    expect(album).toContain('相册已归档（8 项）');
  });

  it('AI 完成通知带状态标记', () => {
    const done = formatAnalyzedNotice([{ kind: 'analyzed', brief: { ...brief, aiStatus: 'done' }, detail: 'a、b' }]);
    expect(done).toContain('✅');
    const partial = formatAnalyzedNotice([
      { kind: 'analyzed', brief: { ...brief, aiStatus: 'partial' }, detail: '' },
    ]);
    expect(partial).toContain('⚠️ 部分');
  });
});
