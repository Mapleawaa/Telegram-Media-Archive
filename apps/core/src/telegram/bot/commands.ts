import { SETTING_KEYS, type MediaListItem } from '@tma/shared';
import type { AiGateway } from '../../ai/gateway.js';
import type { AppContext } from '../../context.js';
import { getMediaDetail, queryMedia } from '../../media/queries.js';
import { categoryLabel } from '../../metadata/category.js';
import { getSetting, setSetting } from '../../settings/store.js';
import { hybridSearch } from '../../search/orchestrator.js';

/**
 * X1-2 Bot 私聊命令。
 *
 * 刻意与 grammy 解耦：这里只做「命令文本 → 回复文本」的纯逻辑，
 * grammy 侧只负责收发。这样命令逻辑可以脱离 Telegram 直接单测/冒烟。
 */

export interface BotCommandDeps {
  ctx: AppContext;
  ai: AiGateway;
}

export const COMMAND_LIST = [
  '/help — 本帮助',
  '/search <关键词> — 搜索媒体（如 /search 季）',
  '/recent — 最近归档 5 条',
  '/detail <媒体ID> — 查看单条详情',
  '/stats — 媒体库统计',
  '/pending — 待人工分类的媒体',
  '/start — 绑定归档通知（私聊本 Bot 时）',
  '/stop — 关闭归档通知',
] as const;

export const HELP_TEXT = ['📖 可用命令：', ...COMMAND_LIST].join('\n');

// ---------- 格式化工具 ----------

function fmtSize(bytes: number): string {
  if (!bytes) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function fmtDuration(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** 一条媒体的概要行（搜索 / 最近 / 待人工 共用） */
export function formatListItem(item: MediaListItem, index: number): string {
  const meta = [
    categoryLabel(item.category ?? ''),
    fmtSize(item.sizeBytes),
    fmtDuration(item.durationSec),
  ]
    .filter(Boolean)
    .join(' · ');
  const aiMark =
    item.aiStatus === 'manual'
      ? '⏸待人工'
      : item.aiStatus === 'pending'
        ? '🤖整理中'
        : item.aiStatus === 'partial'
          ? '🤖部分整理'
          : '';
  const tags = item.tags.length > 0 ? `\n   标签：${item.tags.slice(0, 6).join('、')}` : '';
  return `${index + 1}. 《${item.title}》 #${item.id}\n   ${meta}${aiMark ? ` · ${aiMark}` : ''}${tags}`;
}

function formatList(items: MediaListItem[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item, i) => formatListItem(item, i)).join('\n');
}

// ---------- 通知绑定（X1-1） ----------

/** 通知目标 chat id（0 / 未设置 = 关闭） */
export function readNotifyChatId(ctx: AppContext): number {
  const value = getSetting<unknown>(ctx, SETTING_KEYS.notifyChatId);
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n !== 0 ? n : 0;
}

export function bindNotifyChat(ctx: AppContext, chatId: number): void {
  setSetting(ctx, SETTING_KEYS.notifyChatId, chatId);
}

export function unbindNotifyChat(ctx: AppContext): void {
  setSetting(ctx, SETTING_KEYS.notifyChatId, 0);
}

// ---------- 命令分发 ----------

export async function handleBotCommand(
  deps: BotCommandDeps,
  text: string,
  /** 发命令的私聊 chat id：/start /stop 用它绑定/解绑通知 */
  fromChatId?: number,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return HELP_TEXT;

  // /cmd@botname 的形式也接受（群里 @ 指定机器人的习惯）
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? '').slice(1).split('@')[0]?.toLowerCase() ?? '';
  const arg = parts.slice(1).join(' ').trim();
  const { ctx, ai } = deps;

  switch (cmd) {
    case 'start': {
      // Telegram 的习惯：用户对 Bot 的第一条消息就是 /start —— 就地绑定通知目标
      if (fromChatId !== undefined) {
        bindNotifyChat(ctx, fromChatId);
        return `✅ 已绑定归档通知：之后有新媒体归档、AI 整理完成，都会私聊通知你。\n\n${HELP_TEXT}`;
      }
      return HELP_TEXT;
    }
    case 'stop': {
      if (fromChatId !== undefined) {
        unbindNotifyChat(ctx);
        return '🔇 已关闭归档通知。想重新开启就再发一次 /start。';
      }
      return HELP_TEXT;
    }
    case 'help':
      return HELP_TEXT;
    case 'search': {
      if (!arg) return '用法：/search <关键词>，例如 /search 季';
      const result = await hybridSearch(ctx, ai, { query: arg, filters: {}, limit: 5 });
      return formatList(result.items, `没有找到与「${arg}」相关的媒体`);
    }
    case 'recent': {
      const page = queryMedia(ctx.sqlite, { filters: {}, limit: 5, order: 'recent' });
      return `🕒 最近归档：\n${formatList(page.items, '媒体库还是空的')}`;
    }
    case 'pending': {
      const page = queryMedia(ctx.sqlite, {
        filters: { aiStatus: 'manual' },
        limit: 5,
        order: 'recent',
      });
      const total = queryMedia(ctx.sqlite, {
        filters: { aiStatus: 'manual' },
        limit: 1,
        order: 'recent',
      });
      const head = total.nextCursor ? '（只显示前 5 条，完整列表在应用的 Inbox 页）' : '';
      return `⏸ 待人工分类：\n${formatList(page.items, '没有待人工分类的媒体 🎉')}\n${head}`;
    }
    case 'detail': {
      const id = Number(arg);
      if (!Number.isInteger(id) || id <= 0) return '用法：/detail <媒体ID>，例如 /detail 12';
      const d = getMediaDetail(ctx, id);
      if (!d) return `没有找到媒体 #${id}`;
      const meta = [
        categoryLabel(d.category ?? ''),
        fmtSize(d.sizeBytes),
        fmtDuration(d.durationSec),
        d.quality ?? null,
      ]
        .filter(Boolean)
        .join(' · ');
      const sources = d.sources
        .map((s) => `${s.chatTitle ?? s.chatId}${s.isPrimary ? '（主源）' : ''}`)
        .join('、');
      return [
        `📄 《${d.title}》 #${d.id}`,
        meta,
        d.tags.length > 0 ? `标签：${d.tags.slice(0, 10).join('、')}` : null,
        `来源（${d.sources.length}）：${sources || '无'}`,
        `AI 状态：${d.aiStatus}${d.isSensitive ? ' · 🔒敏感' : ''}`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'stats': {
      const q = (sql: string): number =>
        (ctx.sqlite.prepare(sql).get() as { n: number }).n;
      const total = q(`SELECT COUNT(*) AS n FROM media_asset WHERE deleted_at IS NULL`);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const today = q(
        `SELECT COUNT(*) AS n FROM media_asset WHERE deleted_at IS NULL AND created_at >= ${startOfDay.getTime()}`,
      );
      const pending = q(
        `SELECT COUNT(*) AS n FROM media_asset WHERE deleted_at IS NULL AND ai_status = 'manual'`,
      );
      const catRows = ctx.sqlite
        .prepare(
          `SELECT COALESCE(category, '未分类') AS k, COUNT(*) AS n
           FROM media_asset WHERE deleted_at IS NULL GROUP BY k ORDER BY n DESC`,
        )
        .all() as { k: string; n: number }[];
      const cats = catRows
        .map((r) => `${categoryLabel(r.k) === r.k && r.k === '未分类' ? r.k : categoryLabel(r.k)} ${r.n}`)
        .join(' · ');
      return [
        '📊 媒体库统计',
        `总计 ${total} 条（今日 +${today}）`,
        cats ? `分类：${cats}` : null,
        pending > 0 ? `待人工分类 ${pending} 条（/pending 查看）` : '没有待人工分类的媒体 🎉',
      ]
        .filter(Boolean)
        .join('\n');
    }
    default:
      return `未知命令 /${cmd}。\n${HELP_TEXT}`;
  }
}
