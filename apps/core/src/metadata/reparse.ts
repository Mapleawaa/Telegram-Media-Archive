/**
 * 规则重解析（P5-2 / B9）：**只重跑确定性规则，不碰 AI 产物**。
 *
 * 为什么单独写而不是复用 ingest：ingest 只在建新资产时解析，规则升级后
 * 存量数据不会自动跟着变。重解析让规则可以「事后升级、事后生效」——
 * 这正是派生数据原则的另一面：能从事实源重建的东西，都应该能重建。
 *
 * 边界（很重要）：
 *   - 只更新规则能算出的字段（fileName/year/season/episode/quality/codec/source/audio/titleNorm）
 *   - **不动** summary / extractedBy（那是 AI 的产物）
 *   - 标题只在「确实是规则推导的」前提下改写；**用户改过的标题（title_source='user'）永不触碰**
 *   - 分类按既有优先级回填（rule 可收敛，llm/user 不动）
 */
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { mediaAsset, mediaMetadata, mediaTag } from '../database/schema.js';
import { PARSER_VERSION } from '../ingestion/ingest.js';
import { backfillRuleCategory } from './category.js';
import { rebuildSearchDoc } from './rebuild-search-doc.js';
import { extractHashtags, parseFilename } from './rule-parser.js';
import { filterTags } from './tag-policy.js';
import { cleanRuleTitle, isJunkTitle } from './title-policy.js';

export interface ReparseResult {
  ok: boolean;
  reason?: string;
  /** 规则字段是否有变化 */
  changed: boolean;
  /** 标题是否被改写 */
  titleChanged: boolean;
}

function parseEntities(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function reparseAsset(ctx: AppContext, assetId: number): ReparseResult {
  const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return { ok: false, reason: '媒体不存在', changed: false, titleChanged: false };
  if (asset.deletedAt) return { ok: false, reason: '已删除', changed: false, titleChanged: false };

  const meta = ctx.db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, assetId))
    .get();

  const message = ctx.sqlite
    .prepare(
      `SELECT caption, caption_entities AS captionEntities
       FROM telegram_message WHERE media_asset_id = ? AND is_primary = 1 LIMIT 1`,
    )
    .get(assetId) as { caption: string | null; captionEntities: string | null } | undefined;

  if (!message) {
    return { ok: false, reason: '没有来源消息', changed: false, titleChanged: false };
  }

  // 文件名的事实来源是 ingest 时落库的 media_metadata.file_name
  //（Telegram 消息里没有独立列）；重解析的意义是「规则变了，重算一遍」
  const fileName = meta?.fileName ?? null;

  const parsed = fileName ? parseFilename(fileName) : {};
  const cleanedRuleTitle = parsed.title ? cleanRuleTitle(parsed.title) || undefined : undefined;
  const oldRuleTitle = meta?.titleNorm ?? null;
  const titleLocked = asset.titleSource === 'user';

  let changed = false;
  let titleChanged = false;

  // ---- 1) 规则字段（确定性，只覆盖规则自己的地盘）----
  const patch: Record<string, unknown> = {};
  const fields: [string, unknown][] = [
    ['fileName', fileName],
    ['year', parsed.year ?? null],
    ['season', parsed.season ?? null],
    ['episode', parsed.episode ?? null],
    ['quality', parsed.quality ?? null],
    ['codec', parsed.codec ?? null],
    ['source', parsed.source ?? null],
    ['audio', parsed.audio ?? null],
    ['titleNorm', cleanedRuleTitle ?? null],
    ['parserVersion', PARSER_VERSION],
    ['rawParse', parsed],
  ];
  // rawParse 是 json 列（读出来已是对象），引用比较永远不等 → 对象走 JSON 比较
  const isSame = (current: unknown, value: unknown): boolean => {
    if (current === value) return true;
    if (current == null && value == null) return true;
    if (typeof current === 'object' && typeof value === 'object' && current !== null) {
      return JSON.stringify(current) === JSON.stringify(value);
    }
    return false;
  };

  for (const [key, value] of fields) {
    const current = meta ? (meta as unknown as Record<string, unknown>)[key] : undefined;
    if (!isSame(current, value)) {
      patch[key] = value;
      changed = true;
    }
  }
  if (changed) {
    if (meta) {
      ctx.db
        .update(mediaMetadata)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(mediaMetadata.mediaAssetId, assetId))
        .run();
    } else {
      ctx.db
        .insert(mediaMetadata)
        .values({ mediaAssetId: assetId, ...patch, updatedAt: new Date() })
        .run();
    }
  }

  // ---- 2) 标题：只有「确实是规则推导的」才动 ----
  if (!titleLocked) {
    const current = asset.canonicalTitle;
    const wasRuleDerived = current !== null && (current === oldRuleTitle || isJunkTitle(current));

    if (cleanedRuleTitle && cleanedRuleTitle !== oldRuleTitle) {
      if (current === null || wasRuleDerived) {
        ctx.db
          .update(mediaAsset)
          .set({ canonicalTitle: cleanedRuleTitle, titleSource: 'rule', updatedAt: new Date() })
          .where(eq(mediaAsset.id, assetId))
          .run();
        titleChanged = true;
      }
    } else if (!cleanedRuleTitle && oldRuleTitle && current === oldRuleTitle) {
      // 规则不再产出标题，而旧标题就是当年规则写的 → 清掉，让 UI 用文件名/占位兜底
      ctx.db
        .update(mediaAsset)
        .set({ canonicalTitle: null, titleSource: null, updatedAt: new Date() })
        .where(eq(mediaAsset.id, assetId))
        .run();
      titleChanged = true;
    }
    if (titleChanged) changed = true;
  }

  // ---- 3) 附言 hashtag：规则升级后过滤策略可能也变了（与 ingest 同一套过滤）----
  const hashtags = message.caption
    ? filterTags(extractHashtags(message.caption, parseEntities(message.captionEntities)), new Set())
    : [];
  for (const tag of hashtags) {
    const info = ctx.db
      .insert(mediaTag)
      .values({ mediaAssetId: assetId, tag, source: 'rule' })
      .onConflictDoNothing()
      .run();
    if (info.changes > 0) changed = true;
  }

  // ---- 4) 分类：rule 可收敛，llm/user 不动 ----
  if (backfillRuleCategory(ctx, assetId)) changed = true;

  rebuildSearchDoc(ctx, assetId);
  return { ok: true, changed, titleChanged };
}
