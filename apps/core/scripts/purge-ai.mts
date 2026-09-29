/**
 * 清退指定媒体的 **AI 产物**，退回人工分类队列。
 *
 * 场景（U1/A3）：某来源在配好「跳过 AI」策略**之前**就已入库并富化，
 * 内容已经发给了外部模型。事后补救用本脚本把 AI 产物清干净，改为人工归类。
 *
 * 做什么：
 *   1. 删除该媒体 source ∈ {llm, vision} 的标签（rule/user 标签保留）
 *   2. 清空 AI 摘要 `media_metadata.summary` 与 `extracted_by`
 *   3. 清空 `canonical_title`（AI/视觉描述派生的标题），UI 回落「类型 #id」
 *   4. `ai_status='manual'` + `ai_skip=1`，撤销未完成的 AI 作业
 *   5. 清向量与搜索文档（派生数据保持一致）
 *   ⚠ `ai_runs` / `ai_steps` **保留**：那是「确实调用过模型」的审计事实，不该抹掉。
 *
 * 用法：pnpm -F @tma/core purge:ai 24 25
 */
import { and, eq, inArray } from 'drizzle-orm';
import { pino } from 'pino';
import { AiGateway } from '../src/ai/gateway.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/database/client.js';
import { mediaAsset, mediaEmbedding, mediaMetadata, mediaTag } from '../src/database/schema.js';
import { EventBus } from '../src/events/bus.js';
import { JobQueue } from '../src/jobs/queue.js';
import { rebuildSearchDoc } from '../src/metadata/rebuild-search-doc.js';
import { deleteVector } from '../src/vector/store.js';

const ids = process.argv
  .slice(2)
  .map((v) => Number(v))
  .filter((n) => Number.isInteger(n) && n > 0);

if (ids.length === 0) {
  console.error('用法：pnpm -F @tma/core purge:ai <mediaId...>');
  process.exit(1);
}

const config = loadConfig();
// 本脚本不调模型，用静默 logger 避免日志噪声
const logger = pino({ level: 'silent' });
const dbHandle = openDatabase(config, logger);
const bus = new EventBus(dbHandle.db, logger);
const queue = new JobQueue(dbHandle.sqlite, logger);
const ctx: AppContext = {
  config,
  logger,
  db: dbHandle.db,
  sqlite: dbHandle.sqlite,
  bus,
  queue,
  ai: new AiGateway(dbHandle.db, logger, config),
};

const { db, sqlite } = ctx;
let purged = 0;
let tagsRemoved = 0;

for (const id of ids) {
  const asset = db.select().from(mediaAsset).where(eq(mediaAsset.id, id)).get();
  if (!asset) {
    console.log(`#${id} 不存在，跳过`);
    continue;
  }
  const meta = db
    .select()
    .from(mediaMetadata)
    .where(eq(mediaMetadata.mediaAssetId, id))
    .get();
  const beforeTags = (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM media_tag WHERE media_asset_id = ? AND source IN ('llm','vision')`)
      .get(id) as { n: number }
  ).n;

  const removed = db
    .delete(mediaTag)
    .where(and(eq(mediaTag.mediaAssetId, id), inArray(mediaTag.source, ['llm', 'vision'])))
    .run().changes;
  tagsRemoved += removed;

  if (meta) {
    db.update(mediaMetadata)
      .set({ summary: null, extractedBy: null, updatedAt: new Date() })
      .where(eq(mediaMetadata.mediaAssetId, id))
      .run();
  }

  const cancelled = queue.cancelForMedia(id, 'AI 产物清退：退回人工分类');
  db.update(mediaAsset)
    .set({ canonicalTitle: null, aiStatus: 'manual', aiSkip: true, updatedAt: new Date() })
    .where(eq(mediaAsset.id, id))
    .run();

  db.delete(mediaEmbedding).where(eq(mediaEmbedding.mediaAssetId, id)).run();
  try {
    deleteVector(sqlite, id);
  } catch {
    // 未加载 sqlite-vec / 表不存在时忽略
  }

  rebuildSearchDoc(ctx, id);
  bus.emit('media.manual_review', { mediaId: id, reason: 'ai_purged' }, 'system');

  purged += 1;
  console.log(
    `#${id} 已清退：标题「${asset.canonicalTitle ?? '—'}」→ 空 · AI 标签 ${beforeTags} → 0 · ` +
      `ai_status ${asset.aiStatus} → manual · 撤销作业 ${cancelled} 个`,
  );
}

const left = (
  sqlite.prepare(`SELECT COUNT(*) AS n FROM media_asset WHERE ai_status = 'manual'`).get() as {
    n: number;
  }
).n;

console.log(
  `\n共清退 ${purged} 条 · 删除 AI 标签 ${tagsRemoved} 个 · 当前「待分类」总量 ${left}\n` +
    `提示：ai_runs / ai_steps 已保留（审计：这些内容确实调用过模型）。`,
);
dbHandle.close();
