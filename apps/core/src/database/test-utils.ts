import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { pino } from 'pino';
import type { AppConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { EventBus } from '../events/bus.js';
import { JobQueue } from '../jobs/queue.js';
import * as schema from './schema.js';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, '..', '..', 'drizzle') });
  return { db, sqlite };
}

export function createTestContext(): AppContext {
  const { db, sqlite } = createTestDb();
  const logger = pino({ level: 'silent' });
  const config = { dataDir: ':memory:', LOG_LEVEL: 'silent' } as unknown as AppConfig;
  return {
    config,
    logger,
    db,
    sqlite,
    bus: new EventBus(db, logger),
    queue: new JobQueue(sqlite, logger),
  };
}
