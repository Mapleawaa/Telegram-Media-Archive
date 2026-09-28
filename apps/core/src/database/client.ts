import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  close: () => void;
}

export function openDatabase(config: AppConfig, logger: Logger): DbHandle {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dbPath = path.join(config.dataDir, 'archive.db');

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');

  const db = drizzle(sqlite, { schema });

  const migrationsFolder = path.join(import.meta.dirname, '..', '..', 'drizzle');
  migrate(db, { migrationsFolder });
  logger.info({ dbPath, migrationsFolder }, '数据库已就绪（迁移已应用）');

  return {
    db,
    sqlite,
    close: () => {
      try {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
      } finally {
        sqlite.close();
      }
    },
  };
}
