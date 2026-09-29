import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from '../../database/test-utils.js';
import { ingestMessage } from '../../ingestion/ingest.js';
import { setSetting } from '../../settings/store.js';
import type { IncomingMessage } from '../../telegram/types.js';
import {
  applyAiNo,
  applyAiYes,
  applyCategoryChoice,
  applyGateCallback,
  buildCallbackData,
  categoryKeyboard,
  createPromptScheduler,
  gatePromptKeyboard,
  parseGateCallback,
  readGateMode,
  resolveGateTarget,
} from './gate.js';

function makeCtx(aiEnabled = true) {
  const ctx = createTestContext(
    aiEnabled ? ({ AI_PROVIDER: 'mock', AI_CHAT_MODEL: 'mock/chat' } as never) : {},
  );
  setSetting(ctx, 'ingest_gate_mode', 'ask');
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
      size: 1000,
      durationSec: 60,
    },
    ...overrides,
  };
}

describe('gate 模式', () => {
  it('默认 ask；显式 auto 才是 auto', () => {
    const ctx = makeCtx();
    expect(readGateMode(ctx)).toBe('ask');
    setSetting(ctx, 'ingest_gate_mode', 'auto');
    expect(readGateMode(ctx)).toBe('auto');
  });

  it('ask 模式：归档不入队，保持 pending；auto 模式照旧入队', () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    const asset = ctx.sqlite
      .prepare(`SELECT ai_status AS s FROM media_asset WHERE id = ?`)
      .get(assetId) as { s: string };
    expect(asset.s).toBe('pending');
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs`).get()).toMatchObject({ n: 0 });

    setSetting(ctx, 'ingest_gate_mode', 'auto');
    ingestMessage(ctx, makeMsg({ media: { ...makeMsg().media, fileUniqueId: 'u2', fileName: 'Other.S01E01.mkv' } }));
    const jobs = ctx.sqlite.prepare(`SELECT type FROM jobs WHERE type = 'ai.enrich'`).all() as {
      type: string;
    }[];
    expect(jobs).toHaveLength(1);
  });
});

describe('callback_data 编解码', () => {
  it('单条资产与相册组互逆，且 ≤64 字节', () => {
    for (const target of [
      resolveGateTarget(42, null),
      resolveGateTarget(42, '1761234567890'),
    ] as const) {
      for (const data of [
        buildCallbackData('y', target),
        buildCallbackData('n', target),
        buildCallbackData('c:adult', target),
      ]) {
        expect(data.length).toBeLessThanOrEqual(64);
        expect(parseGateCallback(data)).not.toBeNull();
      }
    }
    expect(parseGateCallback('ai:y:a:42')).toEqual({
      action: 'ai-yes',
      target: { kind: 'asset', assetId: 42 },
    });
    expect(parseGateCallback('c:game:g:grp9')).toEqual({
      action: 'category',
      category: 'game',
      target: { kind: 'group', groupId: 'grp9' },
    });
    expect(parseGateCallback('bogus')).toBeNull();
  });
});

describe('决策应用', () => {
  it('ai-yes：入队 ai.enrich 且不重复排队', () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    const target = resolveGateTarget(assetId, null);

    const first = applyAiYes(ctx, target);
    expect(first.text).toContain('已交给 AI 审核');
    const second = applyAiYes(ctx, target);
    expect(second.text).toContain('不重复排队');

    const jobs = ctx.sqlite.prepare(`SELECT type FROM jobs WHERE type = 'ai.enrich'`).all();
    expect(jobs).toHaveLength(1);
  });

  it('ai-no：标「其他」（user 锁定）+ skipped，并返回分类键盘', () => {
    const ctx = makeCtx();
    const { assetId } = ingestMessage(ctx, makeMsg());
    const result = applyAiNo(ctx, resolveGateTarget(assetId, null));

    expect(result.text).toContain('已标记为「其他」');
    expect(result.keyboard?.inline_keyboard.flat().map((b) => b.text)).toEqual(
      expect.arrayContaining(['成人', '游戏', '图书', '🤖 还是让 AI 审核']),
    );

    const asset = ctx.sqlite
      .prepare(`SELECT category, category_source AS src, ai_status AS s, ai_skip AS skip FROM media_asset WHERE id = ?`)
      .get(assetId) as { category: string; src: string; s: string; skip: number };
    expect(asset).toMatchObject({ category: 'other', src: 'user', s: 'skipped', skip: 1 });
  });

  it('分类点选：写入用户分类（相册目标覆盖全组）', () => {
    const ctx = makeCtx();
    const a = ingestMessage(ctx, makeMsg({ mediaGroupId: 'grp-x' }));
    const b = ingestMessage(
      ctx,
      makeMsg({
        mediaGroupId: 'grp-x',
        media: { ...makeMsg().media, fileUniqueId: 'ub', fileName: 'Other.S02E01.mkv' },
      }),
    );
    const result = applyCategoryChoice(ctx, resolveGateTarget(a.assetId, 'grp-x'), 'game');
    expect(result.text).toContain('已归类：游戏');
    expect(result.text).toContain('（2 条）');

    for (const id of [a.assetId, b.assetId]) {
      const row = ctx.sqlite
        .prepare(`SELECT category, category_source AS src FROM media_asset WHERE id = ?`)
        .get(id) as { category: string; src: string };
      expect(row).toEqual({ category: 'game', src: 'user' });
    }
  });

  it('applyGateCallback：非法数据返回 null；done 的资产不被「否」降级', () => {
    const ctx = makeCtx();
    expect(applyGateCallback(ctx, 'nonsense')).toBeNull();

    const { assetId } = ingestMessage(ctx, makeMsg());
    ctx.sqlite
      .prepare(`UPDATE media_asset SET ai_status = 'done' WHERE id = ?`)
      .run(assetId);
    applyGateCallback(ctx, buildCallbackData('n', resolveGateTarget(assetId, null)));
    const row = ctx.sqlite
      .prepare(`SELECT ai_status AS s FROM media_asset WHERE id = ?`)
      .get(assetId) as { s: string };
    expect(row.s).toBe('done'); // AI 已整理完，不被「否」覆盖
  });
});

describe('键盘', () => {
  it('提问键盘两颗按钮；callback_data 均可解析', () => {
    const kb = gatePromptKeyboard(resolveGateTarget(7, null));
    expect(kb.inline_keyboard).toHaveLength(1);
    const [yes, no] = kb.inline_keyboard[0]!;
    expect(yes!.text).toContain('是');
    expect(parseGateCallback(yes!.callback_data)?.action).toBe('ai-yes');
    expect(parseGateCallback(no!.callback_data)?.action).toBe('ai-no');
  });

  it('分类键盘每个按钮都可解析回对应分类', () => {
    const kb = categoryKeyboard(resolveGateTarget(7, null));
    const rows = kb.inline_keyboard;
    // 前三排：分类按钮
    for (const row of rows.slice(0, -1)) {
      for (const btn of row) {
        const parsed = parseGateCallback(btn.callback_data);
        expect(parsed?.action).toBe('category');
      }
    }
    // 最后一排：反悔回 AI
    const last = rows.at(-1)![0]!;
    expect(parseGateCallback(last.callback_data)?.action).toBe('ai-yes');
  });
});

describe('提示去抖（相册整组只弹一次）', () => {
  it('组内多条只发一次，引用首条消息', async () => {
    vi.useFakeTimers();
    try {
      const sent: { chatId: number; replyTo: number; target: unknown }[] = [];
      const scheduler = createPromptScheduler(async (chatId, replyTo, target) => {
        sent.push({ chatId, replyTo, target });
      }, 100);

      const target = resolveGateTarget(1, 'grp-z');
      scheduler.schedule(target, { chatId: -100, replyToMessageId: 11 });
      scheduler.schedule(target, { chatId: -100, replyToMessageId: 12 });
      scheduler.schedule(target, { chatId: -100, replyToMessageId: 13 });
      await vi.advanceTimersByTimeAsync(150);

      expect(sent).toHaveLength(1);
      expect(sent[0]!.replyTo).toBe(11); // 首条
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
