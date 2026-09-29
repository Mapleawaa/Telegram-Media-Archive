import path from 'node:path';
import { createServer } from './api/server.js';
import { AiGateway } from './ai/gateway.js';
import { enrichMedia } from './ai/enrich.js';
import { consolidateTags } from './ai/consolidate.js';
import { embedAsset } from './ai/embedding.js';
import { loadConfig, redactConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './database/client.js';
import { EventBus } from './events/bus.js';
import { ingestMessage } from './ingestion/ingest.js';
import { JobQueue } from './jobs/queue.js';
import { Worker } from './jobs/worker.js';
import { createLogger, registerSecret } from './logger.js';
import { BotClient } from './telegram/bot/bot-client.js';
import { handleBotCommand } from './telegram/bot/commands.js';
import { createNotifyService } from './telegram/bot/notify.js';
import { ensureThumbnail } from './telegram/bot/thumbnail.js';

const config = loadConfig();
const logger = createLogger(
  config.LOG_LEVEL,
  process.env.NODE_ENV !== 'production',
  config.LOG_FILE_DIR === '' ? undefined : (config.LOG_FILE_DIR ?? path.join(config.dataDir, 'logs')),
);
registerSecret(config.TG_BOT_TOKEN);
registerSecret(config.AI_API_KEY);
registerSecret(config.AI_CHAT_API_KEY);
registerSecret(config.AI_VLM_API_KEY);
registerSecret(config.AI_EMBED_API_KEY);

function readMediaId(payload: unknown, jobType: string): number {
  const mediaId =
    payload && typeof payload === 'object' && 'mediaId' in payload
      ? Number((payload as { mediaId: unknown }).mediaId)
      : NaN;
  if (!Number.isInteger(mediaId) || mediaId <= 0) {
    throw new Error(`${jobType} 缺少有效 mediaId`);
  }
  return mediaId;
}

const dbHandle = openDatabase(config, logger);
const bus = new EventBus(dbHandle.db, logger);
const queue = new JobQueue(dbHandle.sqlite, logger);
queue.resetStale();

const ai = new AiGateway(dbHandle.db, logger, config);

const ctx: AppContext = {
  config,
  logger,
  db: dbHandle.db,
  sqlite: dbHandle.sqlite,
  bus,
  queue,
  ai,
};

const tg = new BotClient({
  config,
  logger,
  onMessage: (msg) => {
    const result = ingestMessage(ctx, msg);
    if (!result.duplicateDelivery) {
      logger.info(
        {
          assetId: result.assetId,
          created: result.assetCreated,
          deduped: result.mergedByDedupe,
          messageId: msg.messageId,
        },
        '归档入库',
      );
    }
  },
  // X1-2：私聊命令（/search /stats …）
  onCommand: (text, chatId) => handleBotCommand({ ctx, ai }, text, chatId),
});

// X1-1：归档通知（入库 / AI 完成 / 拉黑 / 失败 → 私聊）。订阅者身份，不阻塞主链路
const notify = createNotifyService(ctx, (chatId, text) => tg.sendText(chatId, text));
bus.subscribe((evt) => notify.onEvent(evt));

const worker = new Worker(queue, bus, logger);
worker.register('ai.enrich', async (payload) => {
  const mediaId = readMediaId(payload, 'ai.enrich');
  await enrichMedia(ctx, ai, tg, mediaId, ensureThumbnail);
});
worker.register('embedding.create', async (payload) => {
  const mediaId = readMediaId(payload, 'embedding.create');
  await embedAsset(ctx, ai, mediaId);
});
worker.register('tags.consolidate', async (payload) => {
  const mediaId = readMediaId(payload, 'tags.consolidate');
  await consolidateTags(ctx, ai, mediaId);
});
worker.start();

const app = await createServer(ctx, { tg });

try {
  await app.listen({ host: config.CORE_HOST, port: config.CORE_PORT });
  logger.info(redactConfig(config), `core 已启动：http://${config.CORE_HOST}:${config.CORE_PORT}`);
} catch (err) {
  logger.error(err, 'core 启动失败');
  worker.stop();
  dbHandle.close();
  process.exit(1);
}

tg.start().catch((err) => {
  logger.error({ err }, 'Bot 启动失败（core 其余功能不受影响）');
});

let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${sig}，正在退出…`);
    notify.dispose();
    worker.stop();
    void tg
      .stop()
      .catch(() => undefined)
      .then(() => worker.drain())
      .then(() => app.close())
      .then(() => dbHandle.close())
      .then(() => process.exit(0));
  });
}
