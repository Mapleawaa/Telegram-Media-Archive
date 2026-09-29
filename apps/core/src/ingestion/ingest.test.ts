import { SETTING_KEYS } from '@tma/shared';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../database/test-utils.js';
import {
  auditEvents,
  mediaAsset,
  mediaSearchDoc,
  mediaTag,
  telegramMessage,
} from '../database/schema.js';
import { setSetting } from '../settings/store.js';
import type { IncomingMessage } from '../telegram/types.js';
import { ingestMessage } from './ingest.js';

const CHAT_ID = -1002464626889;

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    chatId: CHAT_ID,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    messageDate: Date.now(),
    media: {
      kind: 'video',
      fileId: 'file-1',
      fileUniqueId: 'uniq-1',
      fileName: 'Breaking.Bad.S05E10.2160p.WEB-DL.H.265.mkv',
      mime: 'video/x-matroska',
      size: 1234567890,
      durationSec: 2700,
      width: 3840,
      height: 2160,
      thumbnailFileId: 'thumb-1',
    },
    ...overrides,
  };
}

describe('ingestMessage', () => {
  it('首次入库：建 asset + message + metadata + 搜索文档 + 审计', () => {
    const ctx = createTestContext();
    const result = ingestMessage(ctx, makeMsg());

    expect(result.assetCreated).toBe(true);
    expect(result.duplicateDelivery).toBe(false);

    const asset = ctx.db.select().from(mediaAsset).all();
    expect(asset).toHaveLength(1);
    expect(asset[0]!.canonicalTitle).toBe('Breaking Bad');
    expect(asset[0]!.type).toBe('video');
    expect(asset[0]!.preferredMessageId).toBe(result.messageRowId);

    const messages = ctx.db.select().from(telegramMessage).all();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.isPrimary).toBe(true);

    const doc = ctx.db.select().from(mediaSearchDoc).all();
    expect(doc).toHaveLength(1);
    expect(doc[0]!.title).toBe('Breaking Bad');

    const ftsHit = ctx.sqlite
      .prepare(`SELECT rowid FROM fts_media WHERE fts_media MATCH ?`)
      .all('Breaking Bad');
    expect(ftsHit).toHaveLength(1);

    const audits = ctx.db.select().from(auditEvents).all();
    expect(audits.map((a) => a.event)).toContain('telegram.message.received');
    expect(audits.map((a) => a.event)).toContain('media.created');
  });

  it('重复投递同一条消息：幂等跳过', () => {
    const ctx = createTestContext();
    ingestMessage(ctx, makeMsg());
    const again = ingestMessage(ctx, makeMsg());

    expect(again.duplicateDelivery).toBe(true);
    expect(ctx.db.select().from(mediaAsset).all()).toHaveLength(1);
    expect(ctx.db.select().from(telegramMessage).all()).toHaveLength(1);
  });

  it('同文件二次转发（不同 message_id）：复用 asset，追加来源', () => {
    const ctx = createTestContext();
    const first = ingestMessage(ctx, makeMsg());
    const second = ingestMessage(ctx, makeMsg({ messageId: 2 }));

    expect(second.assetCreated).toBe(false);
    expect(second.assetId).toBe(first.assetId);
    expect(ctx.db.select().from(mediaAsset).all()).toHaveLength(1);

    const messages = ctx.db.select().from(telegramMessage).all();
    expect(messages).toHaveLength(2);
    expect(messages.filter((m) => m.isPrimary)).toHaveLength(1);
  });

  it('dedupe_key 命中（不同 file_unique_id、同名同大小同时长）：合并为一个 asset', () => {
    const ctx = createTestContext();
    const first = ingestMessage(ctx, makeMsg());
    const second = ingestMessage(
      ctx,
      makeMsg({
        messageId: 3,
        media: {
          ...makeMsg().media,
          fileId: 'file-2',
          fileUniqueId: 'uniq-2',
          thumbnailFileId: 'thumb-2',
        },
      }),
    );

    expect(second.mergedByDedupe).toBe(true);
    expect(second.assetId).toBe(first.assetId);
    expect(ctx.db.select().from(mediaAsset).all()).toHaveLength(1);
  });

  it('相册消息记录 media_group_id 且各自独立入库', () => {
    const ctx = createTestContext();
    ingestMessage(ctx, makeMsg({ messageId: 10, mediaGroupId: 'grp-1' }));
    ingestMessage(
      ctx,
      makeMsg({
        messageId: 11,
        mediaGroupId: 'grp-1',
        media: {
          ...makeMsg().media,
          fileId: 'file-2',
          fileUniqueId: 'uniq-2',
          fileName: 'photo-2.jpg',
          size: 222,
        },
      }),
    );

    const messages = ctx.db.select().from(telegramMessage).all();
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.mediaGroupId === 'grp-1')).toBe(true);
    expect(ctx.db.select().from(mediaAsset).all()).toHaveLength(2);
  });

  it('附言 hashtag 自动成为规则标签并进入搜索文档', () => {
    const ctx = createTestContext();
    ingestMessage(
      ctx,
      makeMsg({
        caption: '#Redgectx #异环 好看',
        captionEntities: [
          { type: 'hashtag', offset: 0, length: 9 },
          { type: 'hashtag', offset: 10, length: 3 },
        ],
      }),
    );

    const tags = ctx.db.select().from(mediaTag).all();
    // 标签归一化：ASCII 统一小写
    expect(tags.map((t) => t.tag).sort()).toEqual(['redgectx', '异环']);
    expect(tags.every((t) => t.source === 'rule')).toBe(true);

    const doc = ctx.db.select().from(mediaSearchDoc).all();
    expect(doc[0]!.tags).toContain('异环');
    // trigram 查询词需 >=3 字符，这里用 8 字符的英文标签验证索引同步
    const ftsHit = ctx.sqlite
      .prepare(`SELECT rowid FROM fts_media WHERE fts_media MATCH ?`)
      .all('"Redgectx"');
    expect(ftsHit.length).toBeGreaterThan(0);
  });

  it('转发来源落库（channel / user / hidden_user 三种形态）', () => {
    const ctx = createTestContext();
    ingestMessage(
      ctx,
      makeMsg({
        messageId: 21,
        forward: { originType: 'channel', chatId: -100111, chatTitle: '资源频道', chatUsername: 'res_ch' },
      }),
    );
    ingestMessage(
      ctx,
      makeMsg({
        messageId: 22,
        media: { ...makeMsg().media, fileId: 'f2', fileUniqueId: 'u2' },
        forward: { originType: 'user', senderUserId: 4242, senderName: 'Ada' },
      }),
    );
    ingestMessage(
      ctx,
      makeMsg({
        messageId: 23,
        media: { ...makeMsg().media, fileId: 'f3', fileUniqueId: 'u3' },
        forward: { originType: 'hidden_user', senderName: '匿名君' },
      }),
    );

    const rows = ctx.db.select().from(telegramMessage).all();
    const byId = new Map(rows.map((r) => [r.messageId, r]));
    expect(byId.get(21)).toMatchObject({
      forwardOriginType: 'channel',
      forwardFromChatId: -100111,
      forwardFromChatTitle: '资源频道',
      forwardFromChatUsername: 'res_ch',
    });
    expect(byId.get(22)).toMatchObject({
      forwardOriginType: 'user',
      forwardSenderUserId: 4242,
      forwardSenderName: 'Ada',
    });
    expect(byId.get(23)).toMatchObject({
      forwardOriginType: 'hidden_user',
      forwardSenderName: '匿名君',
      forwardSenderUserId: null,
    });
  });

  it('命中「跳过 AI」来源 → ai_status=manual，不入队，无 AI 记录', () => {
    const ctx = createTestContext({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat' } as never);
    setSetting(ctx, SETTING_KEYS.aiSkipSources, ['channel:-100111']);

    const result = ingestMessage(
      ctx,
      makeMsg({ messageId: 31, forward: { originType: 'channel', chatId: -100111, chatTitle: '敏感频道' } }),
    );

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.id).toBe(result.assetId);
    expect(asset.aiStatus).toBe('manual');
    expect(asset.aiSkip).toBe(true);

    const jobs = ctx.sqlite.prepare(`SELECT type FROM jobs WHERE status = 'pending'`).all() as {
      type: string;
    }[];
    expect(jobs).toHaveLength(0);

    const runs = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM ai_runs`).get() as { n: number };
    expect(runs.n).toBe(0);

    const audits = ctx.db.select().from(auditEvents).all();
    expect(audits.map((a) => a.event)).toContain('media.manual_review');
  });

  it('未命中黑名单的正常来源（auto 门控）→ 照常入队 ai.enrich', () => {
    const ctx = createTestContext({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat' } as never);
    setSetting(ctx, SETTING_KEYS.ingestGateMode, 'auto');
    setSetting(ctx, SETTING_KEYS.aiSkipSources, ['channel:-100999']);

    ingestMessage(
      ctx,
      makeMsg({ messageId: 41, forward: { originType: 'channel', chatId: -100111 } }),
    );

    const asset = ctx.db.select().from(mediaAsset).all()[0]!;
    expect(asset.aiStatus).toBe('pending');
    expect(asset.aiSkip).toBe(false);
    const jobs = ctx.sqlite.prepare(`SELECT type FROM jobs WHERE status = 'pending'`).all() as {
      type: string;
    }[];
    expect(jobs.map((j) => j.type)).toEqual(['ai.enrich']);
  });

  it('入库失败回滚：无半成品数据', () => {
    const ctx = createTestContext();
    ingestMessage(ctx, makeMsg());
    // 手工制造唯一冲突：绕过幂等检查直接再插同 chat/message
    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO telegram_message (media_asset_id, chat_id, message_id, file_id, file_unique_id, message_date, via, is_primary, created_at)
           VALUES (1, ?, 1, 'f', 'u', 0, 'bot', 0, 0)`,
        )
        .run(CHAT_ID),
    ).toThrow();
    expect(ctx.db.select().from(telegramMessage).all()).toHaveLength(1);
  });
});
