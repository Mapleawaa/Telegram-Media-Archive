import { eq } from 'drizzle-orm';
import { SETTING_KEYS, type InlineKeyboard } from '@tma/shared';
import type { AppContext } from '../../context.js';
import { mediaAsset } from '../../database/schema.js';
import { categoryLabel } from '../../metadata/category.js';
import { rebuildSearchDoc } from '../../metadata/rebuild-search-doc.js';
import { getSetting } from '../../settings/store.js';

/**
 * X2 归档门控：转发媒体进群后，Bot 引用该消息问「需要让 AI 审核吗？」。
 *
 * - 「是」→ 照常入队 AI 富化（ai.enrich 作业，dedupeKey 防重复）；
 * - 「否」→ 立即标为「其他」（user 来源锁定），弹出分类键盘让用户手动归档；
 * - 都不点 → 资产保持 pending（不入队、不猜测），按钮一直有效，随时可补选。
 *
 * 本模块与 grammy 解耦：只做「决策 → 数据变更 + 回复内容」，
 * 按钮的收发/编辑消息由 bot-client.ts 完成。callback_data 上限 64 字节，
 * 相册用组号定位（点按钮时再查全组成员，晚到的成员也能被覆盖）。
 */

export type GateMode = 'ask' | 'auto';

export function readGateMode(ctx: AppContext): GateMode {
  const value = getSetting<unknown>(ctx, SETTING_KEYS.ingestGateMode);
  return value === 'auto' ? 'auto' : 'ask'; // 默认 ask（X2 新流程）
}

/** 门控的目标：单条资产 / 整个相册组 */
export type GateTarget = { kind: 'asset'; assetId: number } | { kind: 'group'; groupId: string };

export function resolveGateTarget(assetId: number, mediaGroupId?: string | null): GateTarget {
  return mediaGroupId ? { kind: 'group', groupId: mediaGroupId } : { kind: 'asset', assetId };
}

function encodeTarget(target: GateTarget): string {
  return target.kind === 'group' ? `g:${target.groupId}` : `a:${target.assetId}`;
}

// ---------- callback_data 编解码（≤64 字节） ----------

export interface GateCallback {
  action: 'ai-yes' | 'ai-no' | 'category';
  category?: string;
  target: GateTarget;
}

export function buildCallbackData(action: 'y' | 'n' | `c:${string}`, target: GateTarget): string {
  return action === 'y' || action === 'n' ? `ai:${action}:${encodeTarget(target)}` : `${action}:${encodeTarget(target)}`;
}

export function parseGateCallback(data: string): GateCallback | null {
  const parts = data.split(':');
  if (parts[0] === 'ai') {
    const yes = parts[1] === 'y';
    const kind = parts[2];
    const value = parts[3];
    if (!kind || !value) return null;
    return {
      action: yes ? 'ai-yes' : 'ai-no',
      target: kind === 'g' ? { kind: 'group', groupId: value } : { kind: 'asset', assetId: Number(value) },
    };
  }
  if (parts[0] === 'c') {
    const category = parts[1];
    const kind = parts[2];
    const value = parts[3];
    if (!category || !kind || !value) return null;
    return {
      action: 'category',
      category,
      target: kind === 'g' ? { kind: 'group', groupId: value } : { kind: 'asset', assetId: Number(value) },
    };
  }
  return null;
}

// ---------- 键盘 ----------

/** 「否」之后的分类选择键盘（用户点名的 成人/游戏/图书 在第一排） */
export function categoryKeyboard(target: GateTarget): InlineKeyboard {
  const pick = (key: string): { text: string; callback_data: string } => ({
    text: categoryLabel(key),
    callback_data: buildCallbackData(`c:${key}`, target),
  });
  return {
    inline_keyboard: [
      [pick('adult'), pick('game'), pick('book')],
      [pick('movie'), pick('series'), pick('anime')],
      [pick('gallery'), pick('other')],
      [{ text: '🤖 还是让 AI 审核', callback_data: buildCallbackData('y', target) }],
    ],
  };
}

export function gatePromptKeyboard(target: GateTarget): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '✅ 是，交给 AI', callback_data: buildCallbackData('y', target) },
        { text: '❌ 否，手动归类', callback_data: buildCallbackData('n', target) },
      ],
    ],
  };
}

// ---------- 决策应用 ----------

function resolveAssetIds(ctx: AppContext, target: GateTarget): number[] {
  if (target.kind === 'asset') return [target.assetId];
  const rows = ctx.sqlite
    .prepare(
      `SELECT DISTINCT tm.media_asset_id AS id
       FROM telegram_message tm JOIN media_asset a ON a.id = tm.media_asset_id
       WHERE tm.media_group_id = ? AND a.deleted_at IS NULL`,
    )
    .all(target.groupId) as { id: number }[];
  return rows.map((r) => r.id);
}

export interface GateResult {
  text: string;
  keyboard?: InlineKeyboard;
}

/** 点了「是」：全部资产入队 AI 富化 */
export function applyAiYes(ctx: AppContext, target: GateTarget): GateResult {
  const ids = resolveAssetIds(ctx, target);
  let enqueued = 0;
  for (const id of ids) {
    ctx.db
      .update(mediaAsset)
      .set({ aiStatus: 'pending', aiSkip: false, updatedAt: new Date() })
      .where(eq(mediaAsset.id, id))
      .run();
    const jobId = ctx.queue.enqueue(
      'ai.enrich',
      { mediaId: id },
      { dedupeKey: `ai.enrich:${id}`, priority: 1 },
    );
    if (jobId !== undefined) enqueued += 1;
    ctx.bus.emit('media.updated', { mediaId: id, reason: 'gate_ai_yes' }, 'bot');
  }
  const suffix = ids.length > 1 ? `（${ids.length} 条）` : '';
  const note = enqueued === 0 && ids.length > 0 ? '\n（之前已入队，不重复排队）' : '';
  return { text: `✅ 已交给 AI 审核${suffix}${note}` };
}

/** 点了「否」：标为「其他」（user 锁定），弹分类键盘 */
export function applyAiNo(ctx: AppContext, target: GateTarget): GateResult {
  const ids = resolveAssetIds(ctx, target);
  for (const id of ids) {
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) continue;
    // 只覆盖未完成的（done 的不折腾——AI 已经跑完，人工再看再说）
    if (asset.aiStatus === 'pending' || asset.aiStatus === 'skipped') {
      ctx.db
        .update(mediaAsset)
        .set({
          category: 'other',
          categorySource: 'user',
          aiStatus: 'skipped',
          aiSkip: true,
          updatedAt: new Date(),
        })
        .where(eq(mediaAsset.id, id))
        .run();
      rebuildSearchDoc(ctx, id);
      ctx.bus.emit('media.updated', { mediaId: id, reason: 'gate_ai_no' }, 'bot');
    }
  }
  const suffix = ids.length > 1 ? `（${ids.length} 条）` : '';
  return { text: `已标记为「其他」${suffix}，选择归类：`, keyboard: categoryKeyboard(target) };
}

/** 分类键盘点选：写入用户分类（user 锁定） */
export function applyCategoryChoice(ctx: AppContext, target: GateTarget, category: string): GateResult {
  const ids = resolveAssetIds(ctx, target);
  for (const id of ids) {
    const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
    if (!asset) continue;
    if (asset.aiStatus === 'pending' || asset.aiStatus === 'skipped') {
      ctx.db
        .update(mediaAsset)
        .set({ category, categorySource: 'user', aiStatus: 'skipped', aiSkip: true, updatedAt: new Date() })
        .where(eq(mediaAsset.id, id))
        .run();
      rebuildSearchDoc(ctx, id);
      ctx.bus.emit('media.updated', { mediaId: id, reason: 'gate_classified' }, 'bot');
    }
  }
  const suffix = ids.length > 1 ? `（${ids.length} 条）` : '';
  return { text: `✅ 已归类：${categoryLabel(category)}${suffix}` };
}

/** 回调入口：解析 + 应用；返回给 bot-client 编辑提示消息的内容 */
export function applyGateCallback(ctx: AppContext, data: string): GateResult | null {
  const parsed = parseGateCallback(data);
  if (!parsed) return null;
  switch (parsed.action) {
    case 'ai-yes':
      return applyAiYes(ctx, parsed.target);
    case 'ai-no':
      return applyAiNo(ctx, parsed.target);
    case 'category':
      return applyCategoryChoice(ctx, parsed.target, parsed.category!);
  }
}

// ---------- 提示去抖（相册连发多条消息，只弹一次） ----------

export interface PromptScheduler {
  schedule(target: GateTarget, info: { chatId: number; replyToMessageId: number }): void;
  dispose(): void;
}

export const PROMPT_DEBOUNCE_MS = 1500;

/** 相册成员会在 1 秒内连发 N 条消息：按组缓冲，静默后只对首条消息弹一次提问 */
export function createPromptScheduler(
  send: (chatId: number, replyToMessageId: number, target: GateTarget) => Promise<void>,
  delayMs = PROMPT_DEBOUNCE_MS,
): PromptScheduler {
  const pending = new Map<string, { timer: NodeJS.Timeout; info: { chatId: number; replyToMessageId: number } }>();
  return {
    schedule(target, info) {
      const key = target.kind === 'group' ? `g:${target.groupId}` : `a:${target.assetId}`;
      const existing = pending.get(key);
      if (existing) return; // 已在等：保留最初那条消息作为引用目标
      const timer = setTimeout(() => {
        pending.delete(key);
        void send(info.chatId, info.replyToMessageId, target).catch(() => undefined);
      }, delayMs);
      pending.set(key, { timer, info });
    },
    dispose() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    },
  };
}
