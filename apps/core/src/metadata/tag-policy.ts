/**
 * 标签治理：低价值过滤（分辨率/类型词/群名/未命名/纯数字）、归一化、
 * 按来源优先级去重、每媒体数量上限。
 * 优先级（保留时从高到低）：user > rule > llm > vision
 */
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { mediaTag } from '../database/schema.js';

export type TagSource = 'user' | 'rule' | 'llm' | 'vision';

export const MAX_TAGS_PER_ASSET = 8;

/**
 * 中文低价值标签（精确匹配）：ASCII 版本已在下面正则里，这里补 CJK。
 * - 类型/格式词：模型的输出里几乎每张图都会带「图片」「照片」，白占配额
 * - 占位词：模型没看出内容时的填充（未分类 / 待归档 / 来源未知…）
 * - 方向词：横竖版可由 width/height 确定性算出，不该占标签位（架构原则 §38）
 * 注意：不收 电影/剧集/动漫/图集 等分类词——它们是 P3 的分类体系取值。
 */
const LOW_VALUE_CJK = new Set([
  '图片',
  '照片',
  '转发图片',
  '截图',
  '图像',
  '视频',
  '音频',
  '文件',
  '文档',
  '动图',
  '媒体',
  '未分类',
  '待归档',
  '待补充信息',
  '待整理',
  '来源未知',
  '未知',
  '暂无',
  '媒体归档',
  '横版',
  '横屏',
  '竖版',
  '竖图',
  '竖屏',
  '横向构图',
  '纵向构图',
]);

const LOW_VALUE_RES: RegExp[] = [
  /^\d{3,4}\s*[x×]\s*\d{3,4}$/i, // 1280x720
  /^\d{3,4}\s*[pP]$/, // 720p / 1080p
  /^(photo|photos|video|videos|image|images|audio|document|documents|animation|file|files|img|pic|picture|media|other|unknown|none)$/i,
  /^未命名$/,
  /^#?\d+$/, // 纯数字（年份/编号）
  /^[a-z0-9_-]{24,}$/i, // 长随机串（内部 ID、哈希）
];

/** 归一化：去首尾空白、折叠空白、ASCII 小写（保留 CJK 原样）、截断 64 */
export function normalizeTag(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, 64);
  if (!t) return null;
  return /^[\x20-\x7e]+$/.test(t) ? t.toLowerCase() : t;
}

export function isLowValueTag(tag: string, chatTitles: ReadonlySet<string>): boolean {
  if (LOW_VALUE_RES.some((re) => re.test(tag))) return true;
  if (LOW_VALUE_CJK.has(tag)) return true;
  if (chatTitles.has(tag)) return true;
  return false;
}

/** 过滤 + 归一化 + 组内去重（保序） */
export function filterTags(tags: readonly string[], chatTitles: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    if (isLowValueTag(tag, chatTitles)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

const PRIORITY: Record<TagSource, number> = { user: 3, rule: 2, llm: 1, vision: 0 };

/**
 * 收敛某媒体的标签：
 * 1) 删除低价值标签（不动 user 来源的）
 * 2) 归一化后同标签多来源去重（保留高优先级来源——删除低优先级重复行）
 * 3) 超过上限时按优先级截断（优先级相同则保留较早的）
 * 返回删除的行数。
 */
export function pruneAssetTags(ctx: AppContext, assetId: number): number {
  const { db } = ctx;
  const rows = db
    .select()
    .from(mediaTag)
    .where(eq(mediaTag.mediaAssetId, assetId))
    .all();
  if (rows.length === 0) return 0;

  const chatTitles = new Set(
    (
      ctx.sqlite
        .prepare(
          `SELECT DISTINCT chat_title AS t FROM telegram_message WHERE media_asset_id = ? AND chat_title IS NOT NULL`,
        )
        .all(assetId) as { t: string }[]
    ).map((r) => r.t),
  );

  // 归一化后的代表行：按优先级保留
  const keepByNormalized = new Map<string, (typeof rows)[number]>();
  const toDelete = new Set<number>();

  for (const row of [...rows].sort((a, b) => PRIORITY[b.source] - PRIORITY[a.source] || a.id - b.id)) {
    const normalized = normalizeTag(row.tag);
    if (!normalized || isLowValueTag(normalized, chatTitles)) {
      if (row.source !== 'user') toDelete.add(row.id);
      continue;
    }
    const existing = keepByNormalized.get(normalized);
    if (!existing) keepByNormalized.set(normalized, row);
    else if (row.source !== 'user') toDelete.add(row.id);
  }

  // 上限截断（user 优先，其余按优先级/新旧）
  const kept = [...keepByNormalized.values()]
    .filter((r) => !toDelete.has(r.id))
    .sort((a, b) => PRIORITY[b.source] - PRIORITY[a.source] || a.id - b.id);
  for (const row of kept.slice(MAX_TAGS_PER_ASSET)) {
    if (row.source !== 'user') toDelete.add(row.id);
  }

  if (toDelete.size === 0) return 0;
  const run = ctx.sqlite.transaction(() => {
    let n = 0;
    for (const id of toDelete) {
      n += db.delete(mediaTag).where(eq(mediaTag.id, id)).run().changes;
    }
    return n;
  });
  return run();
}
