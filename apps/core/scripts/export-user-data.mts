/**
 * 导出「不可从 Telegram 重建」的用户数据（用户标签 / 注解 / 设置）为 JSON。
 * 其余数据（元数据、AI 摘要、向量、搜索索引）皆为派生物，可随时重建，不必备份。
 *
 * 用法：pnpm -F @tma/core export:user-data [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database/client.js';
import { createLogger } from '../src/logger.js';

const config = loadConfig();
const logger = createLogger('error', false);
const dbHandle = openDatabase(config, logger);

interface ExportPayload {
  app: string;
  schema: number;
  exportedAt: string;
  dataDir: string;
  counts: { userTags: number; annotations: number; settings: number };
  userTags: {
    assetId: number;
    assetTitle: string | null;
    fileUniqueId: string;
    tag: string;
    createdAt: number;
  }[];
  annotations: {
    assetId: number;
    assetTitle: string | null;
    fileUniqueId: string;
    rawText: string;
    createdAt: number;
  }[];
  settings: { key: string; value: unknown; updatedAt: number }[];
}

const userTags = dbHandle.sqlite
  .prepare(
    `SELECT t.media_asset_id AS assetId, a.canonical_title AS assetTitle, a.file_unique_id AS fileUniqueId,
            t.tag, t.created_at AS createdAt
     FROM media_tag t JOIN media_asset a ON a.id = t.media_asset_id
     WHERE t.source = 'user' ORDER BY t.id`,
  )
  .all() as ExportPayload['userTags'];

const annotations = dbHandle.sqlite
  .prepare(
    `SELECT n.media_asset_id AS assetId, a.canonical_title AS assetTitle, a.file_unique_id AS fileUniqueId,
            n.raw_text AS rawText, n.created_at AS createdAt
     FROM media_annotation n JOIN media_asset a ON a.id = n.media_asset_id
     ORDER BY n.id`,
  )
  .all() as ExportPayload['annotations'];

const settingsRows = dbHandle.sqlite
  .prepare(`SELECT key, value, updated_at AS updatedAt FROM settings ORDER BY key`)
  .all() as { key: string; value: string; updatedAt: number }[];

const settings = settingsRows.map((r) => {
  let value: unknown = r.value;
  try {
    value = JSON.parse(r.value) as unknown;
  } catch {
    // 保留原始字符串
  }
  return { key: r.key, value, updatedAt: r.updatedAt };
});

const payload: ExportPayload = {
  app: 'telegram-media-archive',
  schema: 1,
  exportedAt: new Date().toISOString(),
  dataDir: config.dataDir,
  counts: {
    userTags: userTags.length,
    annotations: annotations.length,
    settings: settings.length,
  },
  userTags,
  annotations,
  settings,
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const defaultOut = path.join(config.dataDir, 'exports', `user-data-${stamp}.json`);
const outPath = path.resolve(process.argv[2] ?? defaultOut);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

dbHandle.close();

console.log(`用户数据已导出：${outPath}`);
console.log(
  `  用户标签 ${payload.counts.userTags} 条 · 注解 ${payload.counts.annotations} 条 · 设置 ${payload.counts.settings} 项`,
);
console.log('  提示：这些是唯一无法从 Telegram 重建的数据，建议定期导出并异地保存。');
