import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';

const startedAt = Date.now();

export async function createServer(_config: AppConfig, logger: Logger) {
  const app = Fastify({ loggerInstance: logger });

  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({
    ok: true as const,
    name: 'telegram-media-archive',
    version: '0.1.0',
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
  }));

  return app;
}
