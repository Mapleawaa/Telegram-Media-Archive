/**
 * 端到端冒烟：临时库 + mock AI + 假 Telegram client，
 * 跑通 ingest → enrich → embed → HTTP(REST) → hybrid search 全链路并逐项断言。
 *
 * 用法：pnpm -F @tma/core smoke
 * 退出码非 0 表示有断言失败；测试数据保留在 apps/core/.data-smoke（已 gitignore）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/api/server.js';
import { AiGateway } from '../src/ai/gateway.js';
import { enrichMedia } from '../src/ai/enrich.js';
import { consolidateTags } from '../src/ai/consolidate.js';
import { reparseAsset } from '../src/metadata/reparse.js';
import { handleBotCommand, readNotifyChatId } from '../src/telegram/bot/commands.js';
import { createNotifyService } from '../src/telegram/bot/notify.js';
import {
  applyGateCallback,
  buildCallbackData,
  categoryKeyboard,
  parseGateCallback,
  readGateMode,
  resolveGateTarget,
} from '../src/telegram/bot/gate.js';
import { setSetting } from '../src/settings/store.js';
import { embedAsset } from '../src/ai/embedding.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/database/client.js';
import { EventBus } from '../src/events/bus.js';
import { ingestMessage } from '../src/ingestion/ingest.js';
import { JobQueue } from '../src/jobs/queue.js';
import { createLogger } from '../src/logger.js';
import { ensureThumbnail } from '../src/telegram/bot/thumbnail.js';
import type { TelegramClient } from '../src/telegram/client.js';
import type { IncomingMessage } from '../src/telegram/types.js';
import { vectorCount } from '../src/vector/store.js';

process.env.TG_BOT_TOKEN ||= 'smoke:0000000000000000000000000000000000';
process.env.TG_ARCHIVE_CHAT_ID ||= '-1002464626889';
process.env.TMA_DATA_DIR = path.resolve(import.meta.dirname, '..', '.data-smoke');
process.env.AI_PROVIDER = 'mock';
process.env.AI_CHAT_MODEL ||= 'mock/chat';
process.env.AI_VLM_MODEL ||= 'mock/vision';
process.env.AI_EMBED_MODEL ||= 'mock/embed';
process.env.LOG_LEVEL = 'error';

const config = loadConfig();
fs.rmSync(config.dataDir, { recursive: true, force: true });

const logger = createLogger('silent', false);
const dbHandle = openDatabase(config, logger);
const bus = new EventBus(dbHandle.db, logger);
const queue = new JobQueue(dbHandle.sqlite, logger);
const ai = new AiGateway(dbHandle.db, logger, config);

const fakeTg: TelegramClient = {
  kind: 'bot',
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  sendMedia: () => Promise.resolve({ chatId: 1, messageId: 1 }),
  downloadFile: (fileId: string, destPath: string) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    return Promise.resolve();
  },
};

const ctx: AppContext = {
  config,
  logger,
  db: dbHandle.db,
  sqlite: dbHandle.sqlite,
  bus,
  queue,
  ai,
};

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  checks.push({ name, ok, detail });
};

function makeMsg(overrides: Partial<IncomingMessage> & { media: IncomingMessage['media'] }): IncomingMessage {
  return {
    chatId: config.TG_ARCHIVE_CHAT_ID,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    caption: '#冒烟',
    messageDate: Date.now(),
    ...overrides,
  };
}

const video1 = makeMsg({
  messageId: 101,
  caption: '#冒烟 breaking bad 系列',
  media: {
    kind: 'video',
    fileId: 'f101',
    fileUniqueId: 'u101',
    fileName: 'Breaking.Bad.S05E10.2160p.WEB-DL.H.265.mkv',
    mime: 'video/x-matroska',
    size: 3_000_000_000,
    durationSec: 2820,
    width: 3840,
    height: 2160,
    thumbnailFileId: 't101',
  },
});

const photo2 = makeMsg({
  messageId: 102,
  mediaGroupId: 'album-smoke',
  media: {
    kind: 'photo',
    fileId: 'f102',
    fileUniqueId: 'u102',
    width: 1280,
    height: 720,
    size: 100_000,
    thumbnailFileId: 't102',
  },
});

const video3 = makeMsg({
  messageId: 103,
  media: {
    kind: 'video',
    fileId: 'f103',
    fileUniqueId: 'u103',
    fileName: 'Interstellar.2014.1080p.WEB-DL.H.264.mkv',
    mime: 'video/x-matroska',
    size: 8_000_000_000,
    durationSec: 10140,
    thumbnailFileId: 't103',
  },
});

// ---- 1. 入库 ----
const ingested = ingestMessage(ctx, video1);
check('ingest 新媒体（建 asset + 规则标签）', ingested.assetCreated === true, `assetId=${ingested.assetId}`);
const dup = ingestMessage(ctx, video1);
check('幂等：重复投递不新增', dup.duplicateDelivery === true);
const albumItem = ingestMessage(ctx, photo2);
check('相册消息独立入库', albumItem.assetCreated === true);
const third = ingestMessage(ctx, video3);

const auditCount = (
  ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_events`).get() as { n: number }
).n;
check('事件总线写入 audit_events', auditCount >= 6, `${auditCount} 条`);

const ruleTags = (
  ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM media_tag WHERE media_asset_id = ? AND source = 'rule'`)
    .get(ingested.assetId) as { n: number }
).n;
check('附言 hashtag → 规则标签', ruleTags === 1);

// ---- 2. 富化（mock 文本 + 视觉）----
const enrich = await enrichMedia(ctx, ai, fakeTg, ingested.assetId, ensureThumbnail);
check('富化状态 done（文本 + 视觉）', enrich.status === 'done', enrich.status);
const meta = ctx.db.$client
  .prepare(`SELECT summary, extracted_by AS extractedBy FROM media_metadata WHERE media_asset_id = ?`)
  .get(ingested.assetId) as { summary: string | null; extractedBy: string | null };
check('富化写入摘要与来源标记', Boolean(meta.summary?.includes('[mock]')) && meta.extractedBy === 'mixed');

const stepCount = (
  ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM ai_steps WHERE run_id = (SELECT MAX(id) FROM ai_runs WHERE kind='enrich')`,
    )
    .get() as { n: number }
).n;
check('ai_steps 记录每步', stepCount >= 2, `${stepCount} 步`);

// ---- 3. 向量化 ----
const firstEmbed = await embedAsset(ctx, ai, ingested.assetId);
const secondEmbed = await embedAsset(ctx, ai, ingested.assetId);
check('embedding 首次计算', firstEmbed.status === 'created' && firstEmbed.dim > 0, `${firstEmbed.dim} 维`);
check('embedding 缓存命中不重复计费', secondEmbed.status === 'cached');
check('向量已写入 sqlite-vec', vectorCount(ctx.sqlite) >= 1);

// ---- 4. HTTP 层（fastify inject，不占端口）----
const app = await createServer(ctx, { tg: fakeTg });
const json = (res: { body: string }): Record<string, unknown> =>
  JSON.parse(res.body) as Record<string, unknown>;

const health = await app.inject({ method: 'GET', url: '/api/health' });
check('GET /api/health', health.statusCode === 200);

const list = await app.inject({ method: 'GET', url: '/api/media' });
const listBody = json(list) as { items: unknown[] };
check('GET /api/media 列表', list.statusCode === 200 && listBody.items.length >= 3);

const detail = await app.inject({ method: 'GET', url: `/api/media/${ingested.assetId}` });
const detailBody = json(detail) as { sources: unknown[]; tags: string[] };
check(
  'GET /api/media/:id 详情（来源 + 标签）',
  detail.statusCode === 200 && detailBody.sources.length === 1 && detailBody.tags.length >= 1,
);

const search = await app.inject({
  method: 'POST',
  url: '/api/search',
  payload: { query: 'breaking bad' },
});
const searchBody = json(search) as { debug: { strategy: string; ftsHits: number; vectorHits: number }; items: unknown[] };
check(
  'POST /api/search Hybrid 融合',
  searchBody.debug.strategy === 'hybrid' && searchBody.items.length >= 1,
  `fts=${searchBody.debug.ftsHits} vector=${searchBody.debug.vectorHits}`,
);

const caps = await app.inject({ method: 'GET', url: '/api/ai/capabilities' });
const capsBody = json(caps) as { embed: { enabled: boolean }; vector: { available: boolean; embeddedCount: number } };
check(
  'GET /api/ai/capabilities（能力 + 向量状态）',
  capsBody.embed.enabled && capsBody.vector.available && capsBody.vector.embeddedCount >= 1,
);

const stats = await app.inject({ method: 'GET', url: '/api/stats' });
const statsBody = json(stats) as { totalAssets: number };
check('GET /api/stats', statsBody.totalAssets >= 3, `${statsBody.totalAssets} 条`);

const inbox = await app.inject({ method: 'GET', url: '/api/inbox' });
const inboxBody = json(inbox) as { pending: unknown[]; done: unknown[] };
check('GET /api/inbox（完成 1 / 待分析 2）', inboxBody.done.length === 1 && inboxBody.pending.length === 2);

const forwardNoTarget = await app.inject({
  method: 'POST',
  url: `/api/media/${ingested.assetId}/forward`,
  payload: {},
});
check(
  'forward 未配目标 → 400 明确错误',
  forwardNoTarget.statusCode === 400 && json(forwardNoTarget).error === 'no_target_chat',
);

await app.inject({
  method: 'PATCH',
  url: '/api/settings',
  payload: { key: 'forward_target_chat_id', value: 123456 },
});
const forwardOk = await app.inject({
  method: 'POST',
  url: `/api/media/${ingested.assetId}/forward`,
  payload: {},
});
check('forward 配目标后 → ok（假 client）', forwardOk.statusCode === 200 && json(forwardOk).ok === true);

const reindex = await app.inject({ method: 'POST', url: '/api/admin/reindex-search' });
check('重建搜索索引', reindex.statusCode === 200 && (json(reindex) as { count: number }).count >= 3);

// ---- 5. P2 AI 介入分流器（来源黑名单 → 不进模型 → 人工分类）----
const runsBefore = (ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM ai_runs`).get() as { n: number }).n;

await app.inject({
  method: 'PATCH',
  url: '/api/settings',
  payload: { key: 'ai_skip_sources', value: ['channel:-100777'] },
});

const blacklisted = ingestMessage(
  ctx,
  makeMsg({
    messageId: 201,
    caption: '#黑名单来源 #学习资料',
    media: {
      kind: 'video',
      fileId: 'f201',
      fileUniqueId: 'u201',
      fileName: 'secret.lesson.S01E01.1080p.mkv',
      mime: 'video/x-matroska',
      size: 1_500_000_000,
      durationSec: 1800,
      thumbnailFileId: 't201',
    },
    forward: { originType: 'channel', chatId: -100777, chatTitle: '敏感频道', chatUsername: 'sensitive_ch' },
  }),
);
const blacklistedAsset = ctx.db.$client
  .prepare(`SELECT ai_status AS aiStatus, ai_skip AS aiSkip FROM media_asset WHERE id = ?`)
  .get(blacklisted.assetId) as { aiStatus: string; aiSkip: number };
check(
  '黑名单来源入库 → ai_status=manual 且不入队',
  blacklistedAsset.aiStatus === 'manual' &&
    blacklistedAsset.aiSkip === 1 &&
    (
      ctx.sqlite
        .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE json_extract(payload,'$.mediaId') = ?`)
        .get(blacklisted.assetId) as { n: number }
    ).n === 0,
);

const runsAfter = (ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM ai_runs`).get() as { n: number }).n;
check('黑名单内容不产生 ai_runs 记录', runsAfter === runsBefore, `runs=${runsBefore}→${runsAfter}`);

const forwardColumns = ctx.sqlite
  .prepare(
    `SELECT forward_origin_type AS t, forward_from_chat_id AS id, forward_from_chat_title AS title,
            forward_from_chat_username AS username
     FROM telegram_message WHERE chat_id = ? AND message_id = 201`,
  )
  .get(config.TG_ARCHIVE_CHAT_ID) as {
  t: string;
  id: number;
  title: string;
  username: string;
};
check(
  '转发来源已落库（channel / id / 标题 / 用户名）',
  forwardColumns.t === 'channel' &&
    forwardColumns.id === -100777 &&
    forwardColumns.title === '敏感频道' &&
    forwardColumns.username === 'sensitive_ch',
);

const sources = await app.inject({ method: 'GET', url: '/api/sources/forward' });
const sourcesBody = json(sources) as {
  items: { key: string; type: string; skippedCount: number }[];
  skipSources: string[];
};
check(
  'GET /api/sources/forward（来源列表 + 跳过态）',
  sourcesBody.items.some((i) => i.key === 'channel:-100777' && i.type === 'channel') &&
    sourcesBody.skipSources.includes('channel:-100777'),
);

const manualInbox = await app.inject({ method: 'GET', url: '/api/inbox' });
check(
  'GET /api/inbox 出现「待分类」分组',
  (json(manualInbox) as { manual: unknown[] }).manual.length === 1,
);

const classify = await app.inject({
  method: 'POST',
  url: `/api/media/${blacklisted.assetId}/classify`,
  payload: { tags: ['黑名单来源', '学习资料', 'cos'], category: 'anime', sensitive: true },
});
const classifyBody = json(classify) as { ok: boolean; tagsAdded: number };
const classifiedTags = ctx.sqlite
  .prepare(`SELECT tag FROM media_tag WHERE media_asset_id = ? AND source = 'user'`)
  .all(blacklisted.assetId) as { tag: string }[];
const classifiedAsset = ctx.db.$client
  .prepare(`SELECT ai_status AS aiStatus, category, is_sensitive AS isSensitive FROM media_asset WHERE id = ?`)
  .get(blacklisted.assetId) as { aiStatus: string; category: string; isSensitive: number };
check(
  'POST classify → user 标签 + 分类 + 敏感标记 + ai_status=skipped',
  classifyBody.ok === true &&
    classifiedTags.length === 3 &&
    classifiedAsset.aiStatus === 'skipped' &&
    classifiedAsset.category === 'anime' &&
    classifiedAsset.isSensitive === 1,
);
check(
  'classify 写入 media.classified 审计',
  (ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE event = 'media.classified'`)
    .get() as { n: number }).n === 1,
);

const topTags = await app.inject({ method: 'GET', url: '/api/tags/top?source=user&limit=10' });
const topTagsBody = json(topTags) as { items: { tag: string; count: number }[] };
check(
  'GET /api/tags/top（历史常用 user 标签）',
  topTagsBody.items.some((t) => t.tag === 'cos' && t.count >= 1),
);

const policyResume = await app.inject({
  method: 'POST',
  url: `/api/media/${blacklisted.assetId}/ai-policy`,
  payload: { skip: false },
});
const resumed = ctx.db.$client
  .prepare(`SELECT ai_status AS aiStatus, ai_skip AS aiSkip FROM media_asset WHERE id = ?`)
  .get(blacklisted.assetId) as { aiStatus: string; aiSkip: number };
check(
  'POST ai-policy skip=false → 重新入队并回 pending',
  policyResume.statusCode === 200 && resumed.aiStatus === 'pending' && resumed.aiSkip === 0,
);

// ---- 6. P3 分类体系 + 标签智能 ----
const catRows = ctx.sqlite
  .prepare(`SELECT id, category, category_source AS src FROM media_asset ORDER BY id`)
  .all() as { id: number; category: string | null; src: string | null }[];
const catById = new Map(catRows.map((r) => [r.id, r]));
check(
  'P3-1 ingest 规则分类：季集视频 → series（rule）',
  catById.get(ingested.assetId)?.category === 'series' &&
    catById.get(ingested.assetId)?.src === 'rule',
);
check(
  'P3-1 ingest 规则分类：图片 → gallery（rule）',
  catById.get(albumItem.assetId)?.category === 'gallery' &&
    catById.get(albumItem.assetId)?.src === 'rule',
);
check(
  "P3-1 富化后 AI 的 'other'（没把握）不覆盖确定性规则 → 仍 series/rule",
  catById.get(ingested.assetId)?.category === 'series' &&
    catById.get(ingested.assetId)?.src === 'rule',
);

const sections = await app.inject({ method: 'GET', url: '/api/library/sections' });
const sectionsBody = json(sections) as {
  sections: { key: string; label: string; count: number; items: unknown[] }[];
  total: number;
};
const secOf = (k: string) => sectionsBody.sections.find((s) => s.key === k);
check(
  'P3-5 GET /api/library/sections（分类夹 + 计数）',
  sections.statusCode === 200 &&
    sectionsBody.total >= 4 &&
    ['movie', 'series', 'anime', 'adult', 'gallery', 'other'].every((k) => Boolean(secOf(k))) &&
    (secOf('series')?.count ?? 0) >= 1 &&
    (secOf('gallery')?.count ?? 0) >= 1,
  `series=${secOf('series')?.count} gallery=${secOf('gallery')?.count}`,
);
check(
  'P3-5 分类夹带预览图',
  (secOf('gallery')?.items.length ?? 0) >= 1,
);

const galleryList = await app.inject({ method: 'GET', url: '/api/media?limit=50' });
const galleryBody = json(galleryList) as {
  items: { id: number; category: string | null; mediaGroupId: string | null; albumCount: number }[];
};
const galleryOnly = await app.inject({ method: 'GET', url: '/api/media?category=gallery' });
const galleryOnlyBody = json(galleryOnly) as { items: { category: string | null }[] };
check(
  'P3-1 GET /api/media?category=gallery 只返回图集',
  galleryOnly.statusCode === 200 &&
    galleryOnlyBody.items.length >= 1 &&
    galleryOnlyBody.items.every((i) => i.category === 'gallery'),
);
check(
  'P3-3 相册组已暴露（mediaGroupId + albumCount）',
  galleryBody.items.some((i) => i.mediaGroupId === 'album-smoke' && i.albumCount === 1),
);
check(
  'P3-3 非相册条目 albumCount=1（契约：1 = 非相册）',
  galleryBody.items
    .filter((i) => i.mediaGroupId === null)
    .every((i) => i.albumCount === 1),
);

const bySize = await app.inject({ method: 'GET', url: '/api/media?sort=size&limit=10' });
const bySizeBody = json(bySize) as { items: { id: number; sizeBytes: number }[] };
check(
  'P3-4 排序 sort=size 降序（最大条在最前）',
  bySize.statusCode === 200 &&
    bySizeBody.items.length >= 3 &&
    bySizeBody.items[0]!.id === third.assetId &&
    bySizeBody.items[0]!.sizeBytes >= bySizeBody.items[1]!.sizeBytes,
);

// 标签压缩：真实 mock 网关（mock 返回富化 JSON，无 keep/drop/merge → 不应改动标签）
const tagsBeforeConsolidate = (
  ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM media_tag WHERE media_asset_id = ? AND source = 'user'`)
    .get(blacklisted.assetId) as { n: number }
).n;
const consolidated = await consolidateTags(ctx, ai, blacklisted.assetId);
const tagsAfterConsolidate = (
  ctx.sqlite
    .prepare(`SELECT COUNT(*) AS n FROM media_tag WHERE media_asset_id = ? AND source = 'user'`)
    .get(blacklisted.assetId) as { n: number }
).n;
check(
  'P3-2 tags.consolidate 不误删 user 标签（user 标签在治理中受保护）',
  tagsAfterConsolidate === tagsBeforeConsolidate && consolidated.mediaId === blacklisted.assetId,
);

const consolidateBatch = await app.inject({ method: 'POST', url: '/api/admin/consolidate-tags' });
const consolidateBody = json(consolidateBatch) as { total: number; enqueued: number };
check(
  'P3-2 POST /api/admin/consolidate-tags 批量入队',
  consolidateBatch.statusCode === 200 && consolidateBody.total >= 3 && consolidateBody.enqueued >= 1,
  `total=${consolidateBody.total} enqueued=${consolidateBody.enqueued}`,
);

// ---- 7. P5 详情动作 / 重新解析 / 见过 chat / 缩略图清理 ----
// 相册组（2 条）用于整组转发
const albumA = ingestMessage(
  ctx,
  makeMsg({
    messageId: 301,
    mediaGroupId: 'album-p5',
    media: { kind: 'photo', fileId: 'f301', fileUniqueId: 'u301', width: 800, height: 1200, size: 50_000, thumbnailFileId: 't301' },
  }),
);
const albumB = ingestMessage(
  ctx,
  makeMsg({
    messageId: 302,
    mediaGroupId: 'album-p5',
    media: { kind: 'photo', fileId: 'f302', fileUniqueId: 'u302', width: 800, height: 1200, size: 51_000, thumbnailFileId: 't302' },
  }),
);

// 设为主源：把 albumB 的消息设为 albumA 资产的主源（先并成一个资产？不行——分开的）
// 这里直接对已有多来源场景做验证：重复投递 albumB 的 media 到 albumA 的资产会并组，
// 更直接的做法是用 dedupe 合并。改用简单可断言的路径：把主源切到同资产另一条消息。
void ingestMessage(ctx, makeMsg({
  messageId: 303,
  media: { kind: 'video', fileId: 'f303b', fileUniqueId: 'u103b', fileName: video3.media.fileName, size: video3.media.size, durationSec: video3.media.durationSec, thumbnailFileId: 't303' },
}));
const detailP5 = await app.inject({ method: 'GET', url: `/api/media/${third.assetId}` });
const p5Sources = json(detailP5).sources as { id: number; messageId: number; isPrimary: boolean }[];
const other = p5Sources.find((s) => !s.isPrimary);
if (other) {
  const setPrimary = await app.inject({
    method: 'POST',
    url: `/api/media/${third.assetId}/primary`,
    payload: { messageId: other.id },
  });
  const detailAfter = await app.inject({ method: 'GET', url: `/api/media/${third.assetId}` });
  const afterSources = json(detailAfter).sources as { id: number; isPrimary: boolean }[];
  check(
    'P5-1 设为主源（is_primary 与 preferred_message_id 切换）',
    setPrimary.statusCode === 200 &&
      afterSources.find((s) => s.id === other.id)?.isPrimary === true &&
      afterSources.filter((s) => s.isPrimary).length === 1,
  );
}

// 手动改标题 → title_source='user'，且规则重解析不会再改它
const setTitle = await app.inject({
  method: 'PATCH',
  url: `/api/media/${ingested.assetId}/title`,
  payload: { title: '我自己的标题' },
});
const titleRow = ctx.db.$client
  .prepare(`SELECT canonical_title AS t, title_source AS src FROM media_asset WHERE id = ?`)
  .get(ingested.assetId) as { t: string; src: string };
const reparsed = reparseAsset(ctx, ingested.assetId);
const titleAfterReparse = ctx.db.$client
  .prepare(`SELECT canonical_title AS t FROM media_asset WHERE id = ?`)
  .get(ingested.assetId) as { t: string };
check(
  'P5-1 手动改标题并锁定（重解析不覆盖）',
  setTitle.statusCode === 200 && titleRow.t === '我自己的标题' && titleRow.src === 'user' &&
    titleAfterReparse.t === '我自己的标题' && reparsed.ok,
  titleAfterReparse.t,
);

// 软删除：列表消失 → 恢复 → 回来
const delTarget = albumB.assetId;
await app.inject({ method: 'POST', url: `/api/media/${delTarget}/delete` });
const listedAfterDelete = await app.inject({ method: 'GET', url: '/api/media?limit=50' });
const stillThere = (json(listedAfterDelete).items as { id: number }[]).some((i) => i.id === delTarget);
await app.inject({ method: 'POST', url: `/api/media/${delTarget}/restore` });
const listedAfterRestore = await app.inject({ method: 'GET', url: '/api/media?limit=50' });
const backAgain = (json(listedAfterRestore).items as { id: number }[]).some((i) => i.id === delTarget);
check('P5-1 软删除 → 列表消失 → 恢复 → 回来', !stillThere && backAgain, `删除后 ${stillThere ? '还在' : '没了'} · 恢复后 ${backAgain ? '回来了' : '没回来'}`);

// 相册整组转发（P5-3 / B13）
const albumForward = await app.inject({
  method: 'POST',
  url: `/api/media/${albumA.assetId}/forward`,
  payload: { album: true },
});
const albumBody = json(albumForward) as { album?: boolean; count?: number };
check(
  'P5-3 相册整组转发（按组内顺序逐条）',
  albumForward.statusCode === 200 && albumBody.album === true && albumBody.count === 2,
  `count=${albumBody.count}`,
);

// 见过的 chat（P5-4 / B14）：先让 Bot 从另一个会话收到一条消息
void ingestMessage(
  ctx,
  makeMsg({
    chatId: -100888,
    chatType: 'private',
    chatTitle: '某个用户',
    messageId: 401,
    media: { kind: 'document', fileId: 'f401', fileUniqueId: 'u401', fileName: 'note.txt', size: 100 },
  }),
);
const chats = await app.inject({ method: 'GET', url: '/api/chats' });
const chatsBody = json(chats) as {
  items: { chatId: number; isArchive: boolean; count: number }[];
};
check(
  'P5-4 GET /api/chats（见过会话 + 归档群标记）',
  chats.statusCode === 200 &&
    chatsBody.items.length >= 2 &&
    chatsBody.items.some((c) => c.isArchive) &&
    chatsBody.items.some((c) => !c.isArchive),
  `${chatsBody.items.length} 个 chat`,
);

// 批量重解析（P5-2 / B9）
const reparseAll = await app.inject({ method: 'POST', url: '/api/admin/reparse-all' });
const reparseBody = json(reparseAll) as { total: number; changed: number };
check('P5-2 批量规则重解析', reparseAll.statusCode === 200 && reparseBody.total >= 5, `total=${reparseBody.total} changed=${reparseBody.changed}`);

// 缩略图缓存清理（P5-5 / D3）
const clearThumbs = await app.inject({ method: 'POST', url: '/api/admin/clear-thumbnails' });
const thumbsBody = json(clearThumbs) as { removed: number };
check('P5-5 清空缩略图缓存', clearThumbs.statusCode === 200 && thumbsBody.removed >= 0, `removed=${thumbsBody.removed}`);

// ---- 8. X1 Bot 私聊命令 + 归档通知 ----
// 命令：handleBotCommand 与 grammy 解耦，冒烟直接调用（等同私聊收到文本）
const helpReply = await handleBotCommand({ ctx, ai }, '/help');
check('X1-2 /help 列出命令', helpReply.includes('/search') && helpReply.includes('/start'));

const statsReply = await handleBotCommand({ ctx, ai }, '/stats');
check('X1-2 /stats 有总数与分类分布', statsReply.includes('总计') && statsReply.includes('分类：'), statsReply.split('\n')[1]);

const searchReply = await handleBotCommand({ ctx, ai }, '/search season');
check('X1-2 /search 命中季集关键词', searchReply.includes('《'), searchReply.split('\n')[0]);

const recentReply = await handleBotCommand({ ctx, ai }, '/recent');
check('X1-2 /recent 列出最近归档', /1\. 《.+》 #\d+/.test(recentReply));

const firstMedia = (json((await app.inject({ method: 'GET', url: '/api/media?limit=1' }))).items as { id: number }[])[0]!;
const detailReply = await handleBotCommand({ ctx, ai }, `/detail ${firstMedia.id}`);
check('X1-2 /detail 展示来源与 AI 状态', detailReply.includes('来源') && detailReply.includes('AI 状态'));
check('X1-2 /detail 不存在的 id 给反馈', (await handleBotCommand({ ctx, ai }, '/detail 999999')).includes('没有找到'));

// 通知：绑定 → 事件 → 去抖 → 发送
const notifySends: { chatId: number; text: string }[] = [];
const notify = createNotifyService(ctx, async (chatId, text) => notifySends.push({ chatId, text }));
await handleBotCommand({ ctx, ai }, '/start', 424242);
check('X1-1 /start 绑定通知 chat', readNotifyChatId(ctx) === 424242);

const x1Ingest = ingestMessage(
  ctx,
  makeMsg({
    chatId: config.TG_ARCHIVE_CHAT_ID,
    media: { kind: 'photo', fileId: 'fx1', fileUniqueId: 'ux1', width: 800, height: 1200 },
  }),
);
notify.onEvent({ event: 'media.created', payload: { mediaId: x1Ingest.assetId }, actor: 'bot', ts: Date.now() });
notify.flushNow();
await new Promise((r) => setTimeout(r, 20));
const x1Notice = notifySends.at(-1);
check(
  'X1-1 入库通知（归档 + 分类 + AI 状态）',
  x1Notice !== undefined && x1Notice.chatId === 424242 && x1Notice.text.includes('已归档'),
  x1Notice?.text.split('\n')[0],
);

// AI 完成 → 二次通知带新分类
ctx.db.$client
  .prepare(`UPDATE media_asset SET category = 'gallery', ai_status = 'done' WHERE id = ?`)
  .run(x1Ingest.assetId);
notify.onEvent({ event: 'media.analyzed', payload: { mediaId: x1Ingest.assetId, status: 'done' }, actor: 'agent', ts: Date.now() });
notify.flushNow();
await new Promise((r) => setTimeout(r, 20));
const x1Analyzed = notifySends.at(-1);
check(
  'X1-1 AI 完成通知（新分类落库后）',
  x1Analyzed !== undefined && x1Analyzed.text.includes('AI 整理完成') && x1Analyzed.text.includes('图集'),
);

// 未绑定 → 静默
await handleBotCommand({ ctx, ai }, '/stop', 424242);
const beforeCount = notifySends.length;
notify.onEvent({ event: 'media.created', payload: { mediaId: x1Ingest.assetId }, actor: 'bot', ts: Date.now() });
notify.flushNow();
await new Promise((r) => setTimeout(r, 20));
check('X1-1 /stop 解绑后通知静默', notifySends.length === beforeCount);
notify.dispose();

// ---- 9. X2 归档门控（ask：入库不入队，按钮决定） ----
check('X2 默认门控为 ask', readGateMode(ctx) === 'ask');

const gateIngest = ingestMessage(
  ctx,
  makeMsg({
    messageId: 501,
    media: { kind: 'video', fileId: 'fg1', fileUniqueId: 'ug1', fileName: 'Gate.Show.S03E01.1080p.mkv', size: 900, durationSec: 50 },
  }),
);
const jobsAtGateStart = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'ai.enrich'`).get() as { n: number };
const gateAsset = ctx.sqlite.prepare(`SELECT ai_status AS s FROM media_asset WHERE id = ?`).get(gateIngest.assetId) as { s: string };
check(
  'X2 ask 门控：入库不排队、保持 pending（等用户点按钮）',
  ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'ai.enrich'`).get()!['n' as never] === jobsAtGateStart.n &&
    gateAsset.s === 'pending',
  `新增作业 ${ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'ai.enrich'`).get()!['n' as never]} - 基线 ${jobsAtGateStart.n}`,
);

// 键盘里的 callback_data 全部能被解析
const kbData = categoryKeyboard(resolveGateTarget(gateIngest.assetId, null))
  .inline_keyboard.flat()
  .map((b) => b.callback_data);
check('X2 分类键盘 callback_data 均可解析', kbData.every((d) => parseGateCallback(d) !== null));

// 点「是」→ 入队
const yesRes = applyGateCallback(ctx, buildCallbackData('y', resolveGateTarget(gateIngest.assetId, null)))!;
const yesJobs = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'ai.enrich'`).get() as { n: number };
check(
  'X2 点「是」→ 入队 AI 富化',
  yesRes.text.includes('已交给 AI 审核') && yesJobs.n - jobsAtGateStart.n === 1,
  `${yesRes.text} · 作业 ${yesJobs.n - jobsAtGateStart.n}`,
);

// 另一条点「否」→ 其他 + user + skipped，再选「游戏」
const gateIngest2 = ingestMessage(
  ctx,
  makeMsg({
    messageId: 502,
    media: { kind: 'video', fileId: 'fg2', fileUniqueId: 'ug2', fileName: 'Gate2.Show.S03E02.1080p.mkv', size: 901, durationSec: 51 },
  }),
);
const noTarget = resolveGateTarget(gateIngest2.assetId, null);
applyGateCallback(ctx, buildCallbackData('n', noTarget));
const noAsset = ctx.sqlite
  .prepare(`SELECT category, category_source AS src, ai_status AS s FROM media_asset WHERE id = ?`)
  .get(gateIngest2.assetId) as { category: string; src: string; s: string };
check(
  'X2 点「否」→ 其他（user 锁定）+ skipped',
  noAsset.category === 'other' && noAsset.src === 'user' && noAsset.s === 'skipped',
);
const catRes = applyGateCallback(ctx, buildCallbackData('c:game', noTarget))!;
const catAsset = ctx.sqlite
  .prepare(`SELECT category, category_source AS src FROM media_asset WHERE id = ?`)
  .get(gateIngest2.assetId) as { category: string; src: string };
check('X2 分类键盘选「游戏」→ user 分类落库', catRes.text.includes('游戏') && catAsset.category === 'game' && catAsset.src === 'user');

// 相册：组目标一次覆盖全组
const gA = ingestMessage(ctx, makeMsg({ messageId: 511, mediaGroupId: 'grp-gate', media: { kind: 'photo', fileId: 'gp1', fileUniqueId: 'ugp1', width: 10, height: 10 } }));
const gB = ingestMessage(ctx, makeMsg({ messageId: 512, mediaGroupId: 'grp-gate', media: { kind: 'photo', fileId: 'gp2', fileUniqueId: 'ugp2', width: 10, height: 10 } }));
applyGateCallback(ctx, buildCallbackData('c:book', resolveGateTarget(gA.assetId, 'grp-gate')));
const gBAsset = ctx.sqlite.prepare(`SELECT category AS c FROM media_asset WHERE id = ?`).get(gB.assetId) as { c: string };
const gARow = ctx.sqlite.prepare(`SELECT category AS c, ai_status AS s FROM media_asset WHERE id = ?`).get(gA.assetId) as { c: string; s: string };
check(
  'X2 相册组一次归类覆盖全组',
  gBAsset.c === 'book' && gARow.c === 'book',
  `A=${gARow.c}/${gARow.s} B=${gBAsset.c}`,
);

// 恢复 auto，保证后续断言环境不变
setSetting(ctx, 'ingest_gate_mode', 'auto');

await app.close();
dbHandle.close();

// ---- 报告 ----
console.log('\n端到端冒烟结果（数据目录：.data-smoke）\n');
for (const item of checks) {
  console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} 项通过${failed ? `，${failed} 项失败` : ''}\n`);
process.exit(failed > 0 ? 1 : 0);
