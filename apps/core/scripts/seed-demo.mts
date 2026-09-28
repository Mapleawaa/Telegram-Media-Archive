/**
 * 生成演示数据库（独立于真实数据）：pnpm -F @tma/core seed:demo
 * 之后用 TMA_DATA_DIR=.data-demo CORE_PORT=8788 启动 core 即可预览完整 UI。
 */
import path from 'node:path';
import { pino } from 'pino';
import { AiGateway } from '../src/ai/gateway.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/database/client.js';
import { mediaAnnotation, mediaTag } from '../src/database/schema.js';
import { EventBus } from '../src/events/bus.js';
import { ingestMessage } from '../src/ingestion/ingest.js';
import { JobQueue } from '../src/jobs/queue.js';
import type { IncomingMessage } from '../src/telegram/types.js';

process.env.TG_BOT_TOKEN ||= 'demo:0000000000000000000000000000000000';
process.env.TG_ARCHIVE_CHAT_ID ||= '-1002464626889';
process.env.TMA_DATA_DIR = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '..', '.data-demo'),
);
process.env.LOG_LEVEL ||= 'silent';

const config = loadConfig();
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

const CHAT_ID = -1002464626889;

function msg(partial: Partial<IncomingMessage> & { media: IncomingMessage['media'] }): IncomingMessage {
  return {
    chatId: CHAT_ID,
    messageId: 1,
    chatType: 'supergroup',
    chatTitle: '归档群',
    senderId: 2211001,
    senderName: 'Maple',
    messageDate: Date.now(),
    ...partial,
  };
}

const samples: IncomingMessage[] = [
  msg({
    messageId: 1001,
    caption: '4K 绝命毒师 在线播放',
    media: {
      kind: 'video',
      fileId: 'f1',
      fileUniqueId: 'u1',
      fileName: 'Breaking.Bad.S05E10.2160p.WEB-DL.DDP5.1.H.265.mkv',
      mime: 'video/x-matroska',
      size: 3_221_225_472,
      durationSec: 2820,
      width: 3840,
      height: 2160,
      thumbnailFileId: 't1',
    },
  }),
  msg({
    messageId: 1002,
    caption: '那个很压抑的赛博朋克片',
    media: {
      kind: 'video',
      fileId: 'f2',
      fileUniqueId: 'u2',
      fileName: 'Blade.Runner.2049.2017.2160p.BluRay.REMUX.HEVC.TrueHD.mkv',
      mime: 'video/x-matroska',
      size: 61_328_441_344,
      durationSec: 9780,
      width: 3840,
      height: 2160,
      thumbnailFileId: 't2',
    },
  }),
  msg({
    messageId: 1003,
    caption: '中文命名的剧集',
    media: {
      kind: 'video',
      fileId: 'f3',
      fileUniqueId: 'u3',
      fileName: '绝命毒师 第五季 4K 在线播放.mp4',
      mime: 'video/mp4',
      size: 2_147_483_648,
      durationSec: 2760,
      width: 3840,
      height: 2160,
      thumbnailFileId: 't3',
    },
  }),
  msg({
    messageId: 1004,
    mediaGroupId: 'album-1',
    media: {
      kind: 'photo',
      fileId: 'f4',
      fileUniqueId: 'u4',
      width: 4032,
      height: 3024,
      size: 3_145_728,
      thumbnailFileId: 't4',
    },
  }),
  msg({
    messageId: 1005,
    mediaGroupId: 'album-1',
    media: {
      kind: 'photo',
      fileId: 'f5',
      fileUniqueId: 'u5',
      width: 3024,
      height: 4032,
      size: 2_621_440,
      thumbnailFileId: 't5',
    },
  }),
  msg({
    messageId: 1006,
    caption: '课程资料',
    media: {
      kind: 'document',
      fileId: 'f6',
      fileUniqueId: 'u6',
      fileName: '学习资料合集.2026.zip',
      mime: 'application/zip',
      size: 524_288_000,
      thumbnailFileId: 't6',
    },
  }),
  msg({
    messageId: 1007,
    media: {
      kind: 'audio',
      fileId: 'f7',
      fileUniqueId: 'u7',
      fileName: 'podcast-ep-42.mp3',
      mime: 'audio/mpeg',
      size: 62_914_560,
      durationSec: 3930,
      thumbnailFileId: 't7',
    },
  }),
  msg({
    messageId: 1008,
    media: {
      kind: 'animation',
      fileId: 'f8',
      fileUniqueId: 'u8',
      fileName: 'cat-loop.gif',
      mime: 'image/gif',
      size: 4_194_304,
      durationSec: 12,
      width: 480,
      height: 270,
      thumbnailFileId: 't8',
    },
  }),
  msg({
    messageId: 1009,
    caption: '解析失败的样本',
    media: {
      kind: 'video',
      fileId: 'f9',
      fileUniqueId: 'u9',
      fileName: 'Unknown_123.mkv',
      mime: 'video/x-matroska',
      size: 1_073_741_824,
      durationSec: 5400,
      width: 1920,
      height: 1080,
    },
  }),
  msg({
    messageId: 1010,
    media: {
      kind: 'video',
      fileId: 'f10',
      fileUniqueId: 'u10',
      fileName: 'Interstellar.2014.1080p.WEB-DL.H.264.AAC.mkv',
      mime: 'video/x-matroska',
      size: 8_589_934_592,
      durationSec: 10140,
      width: 1920,
      height: 1080,
      thumbnailFileId: 't10',
    },
  }),
  msg({
    messageId: 1011,
    media: {
      kind: 'video',
      fileId: 'f11',
      fileUniqueId: 'u11',
      fileName: 'Some.Show.1x03.720p.HDTV.AAC.mp4',
      mime: 'video/mp4',
      size: 1_610_612_736,
      durationSec: 2640,
      width: 1280,
      height: 720,
      thumbnailFileId: 't11',
    },
  }),
];

let assets = 0;
for (const sample of samples) {
  const result = ingestMessage(ctx, sample);
  if (result.assetCreated) assets += 1;
}

// 幂等：重复投递第一条（不应新增）
ingestMessage(ctx, samples[0]!);
// 同文件二次转发（新 message_id，复用 asset）
ingestMessage(ctx, { ...samples[1]!, messageId: 2001 });
// dedupe_key 命中（不同 file_unique_id、同名同大小同时长）
const first = samples[0]!;
ingestMessage(
  ctx,
  msg({
    messageId: 2002,
    media: { ...first.media, fileId: 'f1b', fileUniqueId: 'u1b', thumbnailFileId: 't1b' },
  }),
);

// 给第 1 条加用户标签与注解
ctx.db.insert(mediaTag).values({ mediaAssetId: 1, tag: '收藏', source: 'user' }).run();
ctx.db.insert(mediaTag).values({ mediaAssetId: 1, tag: '剧集', source: 'user' }).run();
ctx.db.insert(mediaAnnotation).values({ mediaAssetId: 1, rawText: '这个是值得收藏的' }).run();
ctx.sqlite
  .prepare(`INSERT INTO jobs (type, payload, status, max_attempts, available_at, created_at, attempts)
            VALUES ('ai.enrich', '{"mediaId":1}', 'dead', 3, ?, ?, 3)`)
  .run(Date.now(), Date.now());

const totalAssets = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM media_asset`).get() as {
  n: number;
};
const totalMessages = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM telegram_message`).get() as {
  n: number;
};

console.log(
  `演示库已生成：${config.dataDir}\n  media_asset=${totalAssets.n}（新建 ${assets}）telegram_message=${totalMessages.n}`,
);
dbHandle.close();
