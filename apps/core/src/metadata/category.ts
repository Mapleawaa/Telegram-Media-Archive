/**
 * 分类体系（P3-1）：电影 / 剧集 / 动漫 / 成人 / 图集 / 其他 + 自定义。
 *
 * **赋值优先级：user > llm > rule**（`categorySource` 记录是谁写的）
 *   - `rule`：确定性推导，不问模型（架构原则 §「确定性优先」）
 *       · 文件名解析出季集（season != null）→ series
 *       · 图片（type=photo）→ gallery（图片天然属图集维度；有 media_group_id 更是相册）
 *       · 成人关键词标签 → adult + 敏感
 *   - `llm`：AI 富化 prompt 的 `category` 字段（语义判断，模型给）
 *   - `user`：人工分类（`POST /api/media/:id/classify`），**最高优先级，永不被覆盖**
 *
 * `categorySource === 'user'` 视为「用户已接管这条的分类与敏感判断」——
 * 规则与 AI 都不再改动它（含 `is_sensitive`）。
 */
import { CATEGORY_PRESETS, type CategorySource } from '@tma/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { mediaAsset, mediaMetadata, mediaTag } from '../database/schema.js';

/** 分类展示名（六类预设 + 未分类兜底） */
export const CATEGORY_LABELS: Record<string, string> = {
  movie: '电影',
  series: '剧集',
  anime: '动漫',
  adult: '成人',
  gallery: '图集',
  other: '其他',
  __none__: '未分类',
};

export const UNCATEGORIZED_KEY = '__none__';

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

/** 中文/英文常见写法 → 预设 key（模型或用户可能写「动漫」「电视剧」「Anime」） */
const CATEGORY_ALIASES: Record<string, string> = {
  电影: 'movie',
  影片: 'movie',
  片: 'movie',
  film: 'movie',
  movies: 'movie',
  剧集: 'series',
  电视剧: 'series',
  连续剧: 'series',
  美剧: 'series',
  英剧: 'series',
  韩剧: 'series',
  日剧: 'series',
  tv: 'series',
  动漫: 'anime',
  动画: 'anime',
  番剧: 'anime',
  animation: 'anime',
  成人: 'adult',
  色情: 'adult',
  涩涩: 'adult',
  限制级: 'adult',
  r18: 'adult',
  nsfw: 'adult',
  图集: 'gallery',
  相册: 'gallery',
  图片集: 'gallery',
  合辑: 'gallery',
  photos: 'gallery',
  album: 'gallery',
  其他: 'other',
  其它: 'other',
  未知: 'other',
  none: 'other',
  unknown: 'other',
};

const PRESET_SET = new Set<string>(CATEGORY_PRESETS);

/**
 * 归一化分类字符串：预设别名归一到 preset key；其余保留为自定义（截断 32）。
 * 空/无意义返回 null。
 */
export function normalizeCategory(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, 32);
  if (!t) return null;
  const ascii = /^[\x20-\x7e]+$/.test(t) ? t.toLowerCase() : t;
  if (PRESET_SET.has(ascii)) return ascii;
  const alias = CATEGORY_ALIASES[ascii] ?? CATEGORY_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  return ascii;
}

/** 成人相关关键词：命中即视为敏感内容（分类 adult + is_sensitive） */
const ADULT_KEYWORDS = [
  '成人',
  '色情',
  '露骨',
  '涩情',
  '涩涩',
  '裸',
  '性暗示',
  '性行为',
  '情色',
  '限制级',
  '里番',
  'r18',
  'nsfw',
  'porn',
  'nude',
  'naked',
  'explicit',
  'hentai',
  'adult',
  '18+',
  '18禁',
];

/** 标签/文本里是否出现成人相关关键词 */
export function looksAdult(text: string): boolean {
  const lower = text.toLowerCase();
  return ADULT_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isAdultCategory(category: string | null | undefined): boolean {
  return category === 'adult';
}

export interface RuleCategoryInput {
  type: string;
  season: number | null;
  mediaGroupId: string | null;
  /** 该媒体现有标签（含 AI/用户），用于成人关键词判定 */
  tags?: readonly string[];
}

export interface RuleCategoryResult {
  category: string | null;
  /** 是否命中成人关键词 → 建议敏感 */
  sensitive: boolean;
}

/**
 * 纯规则推导（无副作用，便于单测）：
 * 只做「代码算得出」的事，不做语义猜测（语义交 llm）。
 *
 * 兜底为 `other`：分类体系本就是「六类全覆盖」，属于任何明确类别之外的都归「其他」，
 * 这样每条媒体始终有分类（不会因为 AI 未跑而空着）。AI 跑出强分类时会以 'llm' 覆盖它。
 */
export function deriveRuleCategory(input: RuleCategoryInput): RuleCategoryResult {
  const tags = input.tags ?? [];
  const sensitive = tags.some((t) => looksAdult(t));

  // 成人优先：U4 要求敏感内容**单独归类**，所以命中成人关键词时不再落 gallery/other，
  // 直接进 adult 夹（同时置敏感）。这是「代码算得出」的判定，不需要模型。
  if (sensitive) {
    return { category: 'adult', sensitive: true };
  }
  if (input.type === 'photo') {
    return { category: 'gallery', sensitive };
  }
  if (input.season != null) {
    return { category: 'series', sensitive };
  }
  return { category: 'other', sensitive };
}

/** 读取一条媒体的规则输入（季集取 metadata，相册组取任一消息） */
export function readRuleInput(ctx: AppContext, assetId: number): RuleCategoryInput {
  const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  const meta = ctx.db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, assetId))
    .get();
  const groupRow = ctx.sqlite
    .prepare(
      `SELECT media_group_id AS g FROM telegram_message
       WHERE media_asset_id = ? AND media_group_id IS NOT NULL
       ORDER BY is_primary DESC, id ASC LIMIT 1`,
    )
    .get(assetId) as { g: string } | undefined;
  const tags = ctx.db
    .select({ tag: mediaTag.tag })
    .from(mediaTag)
    .where(eq(mediaTag.mediaAssetId, assetId))
    .all()
    .map((r) => r.tag);

  return {
    type: asset?.type ?? 'other',
    season: meta?.season ?? null,
    mediaGroupId: groupRow?.g ?? null,
    tags,
  };
}

/**
 * 应用分类（含规则 + 可选 AI 建议），遵守 user > llm > rule 优先级。
 * 不返回副作用细节——需要时用 `readRuleInput` + `deriveRuleCategory` 自行推导。
 */
export function applyDerivedCategory(
  ctx: AppContext,
  assetId: number,
  aiCategory?: string | null,
): { category: string | null; categorySource: CategorySource | null; sensitive: boolean } {
  const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return { category: null, categorySource: null, sensitive: false };

  // 用户已接管 → 规则与 AI 都不再改动（尊重人工决定）
  if (asset.categorySource === 'user') {
    return {
      category: asset.category,
      categorySource: 'user',
      sensitive: asset.isSensitive,
    };
  }

  const rule = deriveRuleCategory(readRuleInput(ctx, assetId));
  const aiCat = normalizeCategory(aiCategory);

  let nextCategory: string | null = null;
  let nextSource: CategorySource | null = null;
  // 'other' 是模型的「没把握」默认值——不拿它去覆盖确定性的规则分类。
  const aiStrong = aiCat !== null && aiCat !== 'other';
  if (aiStrong) {
    nextCategory = aiCat;
    nextSource = 'llm';
  } else if (!asset.category && rule.category) {
    nextCategory = rule.category;
    nextSource = 'rule';
  } else if (!asset.category && aiCat) {
    nextCategory = aiCat;
    nextSource = 'llm';
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (nextCategory) {
    patch.category = nextCategory;
    patch.categorySource = nextSource;
  }
  // 敏感判定：规则命中成人关键词，或最终分类就是 adult（分类与敏感必须一致，
  // 否则会出现「归到成人类却不算敏感」——U4 要求敏感内容正经处理）。
  // 走 user 来源的在这一分支之前已 return，用户显式取消敏感的决定依然有效。
  const effectiveCategory = nextCategory ?? asset.category;
  const nextSensitive = rule.sensitive || effectiveCategory === 'adult' ? true : asset.isSensitive;
  if (nextSensitive !== asset.isSensitive) patch.isSensitive = nextSensitive;

  ctx.db.update(mediaAsset).set(patch).where(eq(mediaAsset.id, assetId)).run();

  return {
    category: nextCategory ?? asset.category,
    categorySource: nextSource ?? asset.categorySource,
    sensitive: nextSensitive,
  };
}

/**
 * 规则回填（供 reindex）：
 *   - 只写 `null` 或 `rule` 来源的分类 —— **不覆盖 llm / user**；
 *   - 规则可以修正规则（例如规则升级后把人内容从 gallery 改判为 adult，让分类收敛）。
 */
export function backfillRuleCategory(ctx: AppContext, assetId: number): boolean {
  const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  // user 已接管 → 分类与敏感都尊重人工决定，一律不动
  if (!asset || asset.categorySource === 'user') return false;

  const rule = deriveRuleCategory(readRuleInput(ctx, assetId));
  const llmLocked = asset.categorySource === 'llm';
  const canWriteCategory = !llmLocked && (asset.category === null || asset.categorySource === 'rule');
  const setCategory = canWriteCategory && Boolean(rule.category) && rule.category !== asset.category;

  // 敏感一致性：分类是 adult 就必须敏感。这是**字段自洽**（不是改分类），
  // 因此对 llm 来源的分类同样生效（真实缺陷 #21：adult/llm 却 is_sensitive=0）。
  const effectiveCategory = setCategory ? rule.category : asset.category;
  const setSensitive = !asset.isSensitive && (rule.sensitive || effectiveCategory === 'adult');

  if (!setCategory && !setSensitive) return false;
  ctx.db
    .update(mediaAsset)
    .set({
      updatedAt: new Date(),
      ...(setCategory ? { category: rule.category, categorySource: 'rule' as const } : {}),
      ...(setSensitive ? { isSensitive: true } : {}),
    })
    .where(eq(mediaAsset.id, assetId))
    .run();
  return true;
}

/** 分类夹计数（含未分类），供 `/api/library/sections` 用 */
export function categoryCounts(ctx: AppContext): Map<string, number> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT COALESCE(category, '__none__') AS k, COUNT(*) AS n
       FROM media_asset WHERE deleted_at IS NULL GROUP BY k`,
    )
    .all() as { k: string; n: number }[];
  return new Map(rows.map((r) => [r.k, r.n]));
}
