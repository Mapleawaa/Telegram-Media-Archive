import type { JobItem, JobStatus, StatsResponse } from '@tma/shared';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import { queryMedia } from '../../media/queries.js';

export function registerStatsRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/stats', async (): Promise<StatsResponse> => {
    const totalAssets = (
      ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM media_asset`).get() as { n: number }
    ).n;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayAdded = (
      ctx.sqlite
        .prepare(`SELECT COUNT(*) AS n FROM media_asset WHERE created_at >= ?`)
        .get(startOfDay.getTime()) as { n: number }
    ).n;

    const recentMedia = queryMedia(ctx.sqlite, {
      filters: {},
      limit: 6,
      order: 'recent',
    }).items;

    const failureRows = ctx.sqlite
      .prepare(
        `SELECT id, type, status, attempts, max_attempts AS maxAttempts, error,
                created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
         FROM jobs WHERE status IN ('failed', 'dead') ORDER BY created_at DESC LIMIT 5`,
      )
      .all() as {
      id: number;
      type: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      error: string | null;
      createdAt: number;
      startedAt: number | null;
      finishedAt: number | null;
    }[];

    const recentFailures: JobItem[] = failureRows.map((r) => ({
      ...r,
      status: r.status as JobStatus,
    }));

    return {
      totalAssets,
      todayAdded,
      jobsByStatus: ctx.queue.counts(),
      recentMedia,
      recentFailures,
    };
  });
}
