import type { JobItem, JobStatus } from '@tma/shared';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';

interface RawJob {
  id: number;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const JOB_SELECT = `SELECT id, type, status, attempts, max_attempts AS maxAttempts, error,
                           created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
                    FROM jobs`;

function mapJob(row: RawJob): JobItem {
  return { ...row, status: row.status as JobStatus };
}

export function registerJobsRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/jobs', async (req) => {
    const query = (req.query ?? {}) as { status?: string; limit?: string };
    const limit = Math.min(Number(query.limit) || 50, 200);
    const status = query.status;

    const rows = (
      status
        ? ctx.sqlite
            .prepare(`${JOB_SELECT} WHERE status = @status ORDER BY id DESC LIMIT @limit`)
            .all({ status, limit })
        : ctx.sqlite.prepare(`${JOB_SELECT} ORDER BY id DESC LIMIT @limit`).all({ limit })
    ) as RawJob[];

    return { items: rows.map(mapJob) };
  });

  app.post('/api/jobs/:id/retry', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'invalid_id' });
    const ok = ctx.queue.retry(id);
    if (ok) ctx.bus.emit('job.retry', { jobId: id }, 'user');
    return { ok };
  });
}
