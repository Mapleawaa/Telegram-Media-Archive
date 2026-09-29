/**
 * 标签压缩作业（P3-2，用户诉求 U5）：**让 AI 只看标签做归并**（不看内容）。
 *
 * 为什么「只看标签」：内容（尤其敏感内容）会触发外部模型的内容审核而拒答；
 * 标签是纯文本、已由上游生成，用它做归并既不烧视觉额度，也不碰审核红线。
 *
 * 产出 `{ keep, drop, merge, category }`：
 *   - `drop`：低价值/冗余标签 → 删除（**user 标签永不删**）
 *   - `merge`：同义/写法变体 → 归并到更规范的那个（**user 标签永不改**）
 *   - `category`：顺带的分类修正（仅当未被用户锁定）
 *
 * 审计：事件 `media.tags_consolidated` 落库，保留 keep/drop/merge 原样以便追溯。
 */
import type { ConsolidateTagsResult, CategorySource } from '@tma/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { mediaAsset, mediaTag } from '../database/schema.js';
import { applyDerivedCategory, normalizeCategory } from '../metadata/category.js';
import { normalizeTag, pruneAssetTags } from '../metadata/tag-policy.js';
import { rebuildSearchDoc } from '../metadata/rebuild-search-doc.js';
import type { AiGateway } from './gateway.js';
import { parseJsonLoose } from './enrich.js';

interface ConsolidatePlan {
  keep?: unknown;
  drop?: unknown;
  merge?: unknown;
  category?: unknown;
}

export function buildConsolidatePrompt(tags: readonly string[]): string {
  return [
    '你在做「标签归并」。**只依据下面这组标签本身，不要推测媒体内容**。',
    '目标：去冗余、合并同义/近义/写法变体，让最终标签既少又准（保留 3-8 个）。',
    '只输出 JSON 对象，不要任何解释，字段：',
    '{"keep": [保留的标签], "drop": [删除的低价值/冗余标签], "merge": {"原标签": "归并后的标签"}, "category": "按标签推断的归档分类 movie|series|anime|adult|gallery|other 之一(无法判断给 other)"}',
    '要求：keep/drop 的元素必须来自下面的列表；merge 的目标可以是列表里的，也可以是更规范的新写法；宁可少动，不要滥删。',
    '',
    `标签列表：${tags.join('、')}`,
  ].join('\n');
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * 对单条媒体执行标签压缩。不抛异常（除 AI 网关自身报错外），供 worker 调用。
 */
export async function consolidateTags(
  ctx: AppContext,
  gateway: AiGateway,
  assetId: number,
): Promise<ConsolidateTagsResult> {
  const empty: ConsolidateTagsResult = { mediaId: assetId, kept: 0, dropped: [], merged: {}, category: null };
  const asset = ctx.db.select().from(mediaAsset).where(eq(mediaAsset.id, assetId)).get();
  if (!asset) return empty;

  const rows = ctx.db.select().from(mediaTag).where(eq(mediaTag.mediaAssetId, assetId)).all();
  if (rows.length === 0) return empty;
  if (!gateway.chatEnabled) return empty;

  const tags = [...new Set(rows.map((r) => r.tag))];

  const plan = await gateway.withRun('consolidate', `标签压缩媒体 #${assetId}`, async (runId) => {
    const response = await gateway.runChat(
      {
        messages: [
          { role: 'system', content: '你是严谨的标签治理助手，只输出 JSON，绝不臆测媒体内容。' },
          { role: 'user', content: buildConsolidatePrompt(tags) },
        ],
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 800,
      },
      { runId, label: 'tags.consolidate' },
    );
    const parsed = parseJsonLoose<ConsolidatePlan>(response.text);
    if (!parsed) {
      // 重要：不能让「模型输出不可解析」变成静默无操作（真机 25 条里有 9 条如此）。
      // 记一条 decision，AI 活动页/Run 详情能查到原因。
      gateway.recordStep(runId, {
        type: 'decision',
        toolName: 'tags.consolidate.unusable',
        output: {
          note: '模型未返回可解析 JSON，本次不改动标签（原标签保留）',
          excerpt: response.text.slice(0, 200),
        },
        status: 'succeeded',
      });
    }
    return parsed;
  });

  if (!plan) return empty;

  const keep = new Set(asStringArray(plan.keep).map((t) => normalizeTag(t)).filter((t): t is string => Boolean(t)));
  const drop = new Set(asStringArray(plan.drop).map((t) => normalizeTag(t)).filter((t): t is string => Boolean(t)));
  const mergeRaw = plan.merge && typeof plan.merge === 'object' ? (plan.merge as Record<string, unknown>) : {};
  const merge: Record<string, string> = {};
  for (const [from, to] of Object.entries(mergeRaw)) {
    if (typeof to !== 'string') continue;
    const f = normalizeTag(from);
    const t = normalizeTag(to);
    if (!f || !t || f === t) continue;
    merge[f] = t;
  }

  // keep 是「明确保留」清单：既不删也不并（但用户标签本就不可动）
  const mergedApplied: Record<string, string> = {};
  const removedIds = new Set<number>();

  const tx = ctx.sqlite.transaction(() => {
    // 1) merge：把非 user 行改名为目标（目标已存在则去重），再删原行
    for (const [from, to] of Object.entries(merge)) {
      const victims = rows.filter((r) => r.tag === from && r.source !== 'user');
      if (victims.length === 0) continue;
      let moved = false;
      for (const v of victims) {
        const info = ctx.db
          .insert(mediaTag)
          .values({ mediaAssetId: assetId, tag: to, source: v.source })
          .onConflictDoNothing()
          .run();
        ctx.db.delete(mediaTag).where(eq(mediaTag.id, v.id)).run();
        removedIds.add(v.id);
        if (info.changes > 0) moved = true;
      }
      if (moved) mergedApplied[from] = to;
    }

    // 2) drop：按行精确删除（**只删非 user 行**；keep 里的不动）
    for (const r of rows) {
      if (r.source === 'user') continue;
      if (removedIds.has(r.id)) continue;
      if (!drop.has(r.tag) || keep.has(r.tag)) continue;
      ctx.db.delete(mediaTag).where(eq(mediaTag.id, r.id)).run();
    }

    // 3) 归一化后收敛（上限 8、多来源去重、低价值过滤）；user 标签天然受保护
    pruneAssetTags(ctx, assetId);
  });
  tx();

  // category：仅当未被用户锁定
  let category: string | null = null;
  const cat = normalizeCategory(typeof plan.category === 'string' ? plan.category : null);
  if (cat) {
    const res = applyDerivedCategory(ctx, assetId, cat);
    category = res.category;
  }

  // 汇总实际被删的标签（重读一遍再回填结果）
  const after = new Set(
    ctx.db.select({ tag: mediaTag.tag }).from(mediaTag).where(eq(mediaTag.mediaAssetId, assetId)).all().map((r) => r.tag),
  );
  const droppedFinal = [...new Set([...tags].filter((t) => !after.has(t) && !(t in mergedApplied)))];
  const kept = after.size;

  rebuildSearchDoc(ctx, assetId);
  ctx.bus.emit(
    'media.tags_consolidated',
    { mediaId: assetId, kept, dropped: droppedFinal, merged: mergedApplied, category },
    'agent',
  );

  return { mediaId: assetId, kept, dropped: droppedFinal, merged: mergedApplied, category };
}
