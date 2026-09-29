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
