import type { Database } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Logger } from 'pino';

export const VEC_TABLE = 'vec_media';

export interface KnnHit {
  assetId: number;
  distance: number;
}

/** 加载 sqlite-vec 可加载扩展；失败时返回 false（向量检索整体降级为不可用） */
export function loadVecExtension(sqlite: Database, logger: Logger): boolean {
  try {
    sqliteVec.load(sqlite);
    const version = (
      sqlite.prepare('SELECT vec_version() AS v').get() as { v: string }
    ).v;
    logger.info({ version }, 'sqlite-vec 已加载');
    return true;
  } catch (err) {
    logger.warn({ err }, 'sqlite-vec 加载失败：向量检索将不可用（其余功能不受影响）');
    return false;
  }
}

export function getVecDim(sqlite: Database): number | null {
  const row = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE name = ?`)
    .get(VEC_TABLE) as { sql: string } | undefined;
  if (!row) return null;
  const match = /float\[(\d+)\]/i.exec(row.sql);
  return match ? Number(match[1]) : null;
}

/**
 * 保证 vec 表存在且维度匹配。维度变化时直接重建（向量是派生数据，
 * 可重算；同时清空 media_embedding 记录以便重新生成）。
 */
export function ensureVecTable(sqlite: Database, dim: number, logger: Logger): void {
  const current = getVecDim(sqlite);
  if (current === dim) return;

  if (current !== null) {
    logger.warn(
      { from: current, to: dim },
      'embedding 维度变化：重建向量表并清除旧记录（下次入队时会重新计算）',
    );
    sqlite.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
    sqlite.prepare(`DELETE FROM media_embedding`).run();
  }
  sqlite.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(asset_id INTEGER PRIMARY KEY, embedding float[${dim}])`,
  );
  logger.info({ dim }, '向量表已就绪');
}

/** vec0 主键不接受参数绑定的普通整数，需 CAST(? AS INTEGER)（实测 sqlite-vec 0.1.9） */
export function upsertVector(sqlite: Database, assetId: number, vector: number[]): void {
  const buffer = new Float32Array(vector);
  sqlite.prepare(`DELETE FROM ${VEC_TABLE} WHERE asset_id = ?`).run(assetId);
  sqlite
    .prepare(`INSERT INTO ${VEC_TABLE}(asset_id, embedding) VALUES (CAST(? AS INTEGER), ?)`)
    .run(assetId, buffer);
}

export function deleteVector(sqlite: Database, assetId: number): void {
  sqlite.prepare(`DELETE FROM ${VEC_TABLE} WHERE asset_id = ?`).run(assetId);
}

export function knnSearch(sqlite: Database, vector: number[], limit: number): KnnHit[] {
  const buffer = new Float32Array(vector);
  return sqlite
    .prepare(
      `SELECT asset_id AS assetId, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
    )
    .all(buffer, limit) as KnnHit[];
}

export function vectorCount(sqlite: Database): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${VEC_TABLE}`).get() as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}
