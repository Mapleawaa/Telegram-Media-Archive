import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { AiGateway } from './ai/gateway.js';
import type { AppConfig } from './config.js';
import type { Db } from './database/client.js';
import type { EventBus } from './events/bus.js';
import type { JobQueue } from './jobs/queue.js';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  db: Db;
  sqlite: Database;
  bus: EventBus;
  queue: JobQueue;
  ai: AiGateway;
}
