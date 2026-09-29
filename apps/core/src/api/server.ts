import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from '../context.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerChatsRoutes } from './routes/chats.js';
import { registerJobsRoutes } from './routes/jobs.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerMediaRoutes, type ServerDeps } from './routes/media.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSourcesRoutes } from './routes/sources.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerTagsRoutes } from './routes/tags.js';
import { registerWs, WsHub } from './ws.js';

const startedAt = Date.now();

export type { ServerDeps };

export async function createServer(ctx: AppContext, deps: ServerDeps) {
  const app = Fastify({ loggerInstance: ctx.logger });

  await app.register(cors, { origin: true });

  const hub = new WsHub();
  ctx.bus.subscribe((evt) => {
    hub.broadcast({ type: 'event', event: evt.event, ts: evt.ts, payload: evt.payload });
  });
  await registerWs(app, ctx, hub);

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid_request', issues: err.issues });
    }
    const e = err as { statusCode?: number; message?: string };
    const statusCode = e.statusCode ?? 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: 'request_error', message: e.message });
    }
    req.log.error({ err }, '请求处理失败');
    return reply.status(500).send({ error: 'internal_error', message: e.message ?? 'unknown' });
  });

  app.get('/api/health', async () => ({
    ok: true as const,
    name: 'telegram-media-archive',
    version: '0.1.0',
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
  }));

  registerMediaRoutes(app, ctx, deps);
  registerSearchRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerJobsRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerAiRoutes(app, ctx);
  registerSourcesRoutes(app, ctx);
  registerTagsRoutes(app, ctx);
  registerChatsRoutes(app, ctx);

  return app;
}
