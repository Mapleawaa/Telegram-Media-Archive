import type { BusEvent } from '../../events/bus.js';
import type { AppContext } from '../../context.js';
import { categoryLabel } from '../../metadata/category.js';
import { readNotifyChatId } from './commands.js';

/**
 * X1-1 归档通知：媒体入库 / AI 整理完成后，主动私聊通知绑定的用户。
 *
 * 设计要点：
 * - 事件源是 EventBus（入库、AI 完成、拉黑、作业失败都在那里发声），本服务只订阅不动流水线；
 * - 未绑定（notify_chat_id=0）时静默丢弃——通知是订阅者，不是链路的必需环节；
 * - 相册去抖：同组消息会在几秒内连发 N 个 media.created，按 media_group_id 缓冲 2 秒
 *   合并成一条；单条媒体走 300ms 微去抖（顺带合并同一资产的重复通知）。
 */

export interface NotifyAssetBrief {
  mediaId: number;
  title: string;
  type: string;
  category: string | null;
  aiStatus: string;
}

interface PendingNotice {
  kind: 'archived' | 'merged' | 'analyzed' | 'manual' | 'failed';
  brief: NotifyAssetBrief;
  detail?: string;
}

export const ARCHIVE_DEBOUNCE_MS = 300;
export const ALBUM_DEBOUNCE_MS = 2000;

/** 发送通道抽象：生产环境是 Bot sendMessage，测试里是数组收集 */
export type NotifySender = (chatId: number, text: string) => Promise<void>;

function assetBrief(ctx: AppContext, mediaId: number): NotifyAssetBrief | null {
  const row = ctx.sqlite
    .prepare(
      `SELECT a.id, COALESCE(a.canonical_title, '') AS title, a.type, a.category, a.ai_status AS aiStatus
       FROM media_asset a WHERE a.id = ? AND a.deleted_at IS NULL`,
    )
    .get(mediaId) as
    | { id: number; title: string; type: string; category: string | null; aiStatus: string }
    | undefined;
  if (!row) return null;
  return { mediaId: row.id, title: row.title || `媒体 #${row.id}`, type: row.type, category: row.category, aiStatus: row.aiStatus };
}

// ---------- 纯文本格式化（导出便于单测） ----------

const TYPE_LABELS: Record<string, string> = {
  video: '视频',
  photo: '图片',
  audio: '音频',
  animation: '动图',
  document: '文档',
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function formatArchivedNotice(items: PendingNotice[], albumCount: number | null): string {
  const first = items[0];
  if (!first) return '';
  const aiPending = first.brief.aiStatus === 'pending';
  const lines: string[] = [];
  if (albumCount !== null && albumCount > 1) {
    lines.push(`📥 相册已归档（${albumCount} 项）`);
  } else {
    lines.push(`📥 已归档：${first.brief.title}`);
    lines.push(`类型：${typeLabel(first.brief.type)} · 分类：${categoryLabel(first.brief.category ?? 'other')}`);
  }
  if (aiPending) {
    lines.push('🤖 AI 整理中，完成后会再通知你');
  } else if (first.brief.aiStatus === 'manual') {
    lines.push('⏸ 该来源已被拉黑，进入人工分类队列');
  } else if (first.brief.aiStatus === 'skipped') {
    lines.push('💤 未启用 AI，只做了规则归类');
  }
  return lines.join('\n');
}

export function formatMergedNotice(item: PendingNotice): string {
  return `🔁 与已有条目相同，已合并：${item.brief.title}（现在共 ${item.detail ?? '?'} 个来源）`;
}

export function formatAnalyzedNotice(items: PendingNotice[]): string {
  const parts: string[] = [];
  for (const item of items.slice(0, 5)) {
    const statusText =
      item.brief.aiStatus === 'done'
        ? '✅'
        : item.brief.aiStatus === 'partial'
          ? '⚠️ 部分'
          : item.brief.aiStatus;
    parts.push(
      [
        `🤖 AI 整理完成（${statusText}）`,
        `《${item.brief.title}》`,
        `分类：${categoryLabel(item.brief.category ?? 'other')}${item.detail ? `\n标签：${item.detail}` : ''}`,
      ].join('\n'),
    );
  }
  const extra = items.length > 5 ? `\n…还有 ${items.length - 5} 条` : '';
  return `${parts.join('\n———\n')}${extra}`;
}

export function formatManualNotice(items: PendingNotice[]): string {
  const lines = items.slice(0, 5).map((i) => `⏸ 进人工分类队列：${i.brief.title}`);
  const extra = items.length > 5 ? `\n…还有 ${items.length - 5} 条` : '';
  return `${lines.join('\n')}${extra}`;
}

export function formatFailedNotice(item: PendingNotice): string {
  const reason = (item.detail ?? '').slice(0, 120);
  return `⚠️ AI 整理失败（重试后仍失败）：${item.brief.title}${reason ? `\n原因：${reason}` : ''}`;
}

// ---------- 服务 ----------

export interface NotifyService {
  /** 订阅 EventBus 的回调 */
  onEvent(evt: BusEvent): void;
  /** 立刻把缓冲中的通知发出去（测试用） */
  flushNow(): void;
  dispose(): void;
  /** 测试断言用：已发送的通知 */
  readonly sent: { chatId: number; text: string }[];
}

export function createNotifyService(ctx: AppContext, send: NotifySender): NotifyService {
  const buffers = new Map<string, { timer: NodeJS.Timeout; notices: PendingNotice[]; albumCount: number | null }>();
  const sent: { chatId: number; text: string }[] = [];

  function buffer(key: string, delayMs: number, notice: PendingNotice, albumCount: number | null = null): void {
    const existing = buffers.get(key);
    if (existing) {
      existing.notices.push(notice);
      if (albumCount !== null) existing.albumCount = albumCount;
      return;
    }
    const timer = setTimeout(() => void flush(key), delayMs);
    buffers.set(key, { timer, notices: [notice], albumCount });
  }

  async function flush(key: string): Promise<void> {
    const entry = buffers.get(key);
    if (!entry) return;
    buffers.delete(key);
    clearTimeout(entry.timer);

    const chatId = readNotifyChatId(ctx);
    if (!chatId) return; // 未绑定：静默丢弃

    const notices = entry.notices;
    const byKind = (kind: PendingNotice['kind']): PendingNotice[] => notices.filter((n) => n.kind === kind);

    const archived = byKind('archived');
    const merged = byKind('merged');
    const analyzed = byKind('analyzed');
    const manual = byKind('manual');
    const failed = byKind('failed');

    const texts: string[] = [];
    if (archived.length > 0) texts.push(formatArchivedNotice(archived, entry.albumCount));
    for (const m of merged) texts.push(formatMergedNotice(m));
    if (analyzed.length > 0) texts.push(formatAnalyzedNotice(analyzed));
    if (manual.length > 0) texts.push(formatManualNotice(manual));
    for (const f of failed) texts.push(formatFailedNotice(f));

    if (texts.length === 0) return;
    // Telegram 单条消息上限 4096 字符；超长截断（通知是概要，不是全文）
    let text = texts.join('\n———\n');
    if (text.length > 3900) text = `${text.slice(0, 3900)}\n…（内容过长已截断）`;
    try {
      await send(chatId, text);
      sent.push({ chatId, text });
    } catch (err) {
      ctx.logger.error({ err, chatId }, '归档通知发送失败');
    }
  }

  function groupKeyFor(mediaId: number, delayMs: number): { key: string; delay: number; albumCount: number | null } {
    const g = ctx.sqlite
      .prepare(
        `SELECT media_group_id AS g FROM telegram_message
         WHERE media_asset_id = ? AND media_group_id IS NOT NULL LIMIT 1`,
      )
      .get(mediaId) as { g: string | null } | undefined;
    if (g?.g) {
      const count = (
        ctx.sqlite
          .prepare(
            `SELECT COUNT(DISTINCT tm.media_asset_id) AS n
             FROM telegram_message tm JOIN media_asset a ON a.id = tm.media_asset_id
             WHERE tm.media_group_id = ? AND a.deleted_at IS NULL`,
          )
          .get(g.g) as { n: number }
      ).n;
      return { key: `group:${g.g}`, delay: ALBUM_DEBOUNCE_MS, albumCount: count };
    }
    return { key: `asset:${mediaId}`, delay: delayMs, albumCount: null };
  }

  return {
    sent,
    onEvent(evt) {
      switch (evt.event) {
        case 'media.created': {
          const mediaId = Number(evt.payload.mediaId);
          if (!Number.isInteger(mediaId)) return;
          const brief = assetBrief(ctx, mediaId);
          if (!brief) return; // 已被软删等场景
          const { key, delay, albumCount } = groupKeyFor(mediaId, ARCHIVE_DEBOUNCE_MS);
          buffer(key, delay, { kind: 'archived', brief }, albumCount);
          return;
        }
        case 'media.updated': {
          // 只有「去重合并」的 media.updated 才通知（路由侧的更新带 reason，不带 deduped）
          if (evt.payload.deduped !== true) return;
          const mediaId = Number(evt.payload.mediaId);
          const brief = assetBrief(ctx, mediaId);
          if (!brief) return;
          const count = (
            ctx.sqlite
              .prepare(`SELECT COUNT(*) AS n FROM telegram_message WHERE media_asset_id = ?`)
              .get(mediaId) as { n: number }
          ).n;
          buffer(`asset:${mediaId}`, ARCHIVE_DEBOUNCE_MS, {
            kind: 'merged',
            brief,
            detail: String(count),
          });
          return;
        }
        case 'media.analyzed': {
          const mediaId = Number(evt.payload.mediaId);
          const brief = assetBrief(ctx, mediaId);
          if (!brief) return;
          const tags = (
            ctx.sqlite
              .prepare(
                `SELECT group_concat(DISTINCT tag) AS t FROM (SELECT tag FROM media_tag WHERE media_asset_id = ? ORDER BY rowid DESC LIMIT 6)`,
              )
              .get(mediaId) as { t: string | null }
          ).t;
          buffer(`asset:${mediaId}`, ARCHIVE_DEBOUNCE_MS, {
            kind: 'analyzed',
            brief,
            detail: tags ?? '',
          });
          return;
        }
        case 'media.manual_review': {
          const mediaId = Number(evt.payload.mediaId);
          const brief = assetBrief(ctx, mediaId);
          if (!brief) return;
          buffer(`asset:${mediaId}`, ARCHIVE_DEBOUNCE_MS, { kind: 'manual', brief });
          return;
        }
        case 'job.failed': {
          // 每次尝试失败都会发 job.failed；只有最终死亡（不再重试）才打扰用户
          if (evt.payload.type !== 'ai.enrich') return;
          const jobId = Number(evt.payload.jobId);
          const job = ctx.sqlite.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as
            | { status: string }
            | undefined;
          if (job?.status !== 'dead') return;
          const mediaRow = ctx.sqlite
            .prepare(`SELECT payload FROM jobs WHERE id = ?`)
            .get(jobId) as { payload: string } | undefined;
          const mediaId = mediaRow ? Number(JSON.parse(mediaRow.payload)?.mediaId) : NaN;
          const brief = Number.isInteger(mediaId) ? assetBrief(ctx, mediaId) : null;
          if (!brief) return;
          buffer(`asset:${brief.mediaId}`, ARCHIVE_DEBOUNCE_MS, {
            kind: 'failed',
            brief,
            detail: String(evt.payload.error ?? ''),
          });
          return;
        }
        default:
          return;
      }
    },
    flushNow() {
      // 复制 key 列表：flush 内部会 delete，迭代快照避免遍历时修改
      const keys = Array.from(buffers.keys());
      for (const key of keys) void flush(key);
    },
    dispose() {
      for (const entry of buffers.values()) clearTimeout(entry.timer);
      buffers.clear();
    },
  };
}
