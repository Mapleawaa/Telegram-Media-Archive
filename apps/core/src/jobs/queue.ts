import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';

export interface EnqueueOptions {
  dedupeKey?: string;
  priority?: number;
  delayMs?: number;
  maxAttempts?: number;
}

export interface JobRow {
  id: number;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
}

interface RawJobRow {
  id: number;
  type: string;
  payload: string;
  status: string;
  attempts: number;
  maxAttempts: number;
}

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const STALE_RUNNING_MS = 10 * 60_000;

export class JobQueue {
  constructor(
    private readonly sqlite: Database,
    private readonly logger: Logger,
  ) {}

  enqueue(type: string, payload: unknown, opts: EnqueueOptions = {}): number | undefined {
    const now = Date.now();
    const info = this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO jobs (type, payload, status, priority, max_attempts, dedupe_key, available_at, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        type,
        JSON.stringify(payload ?? {}),
        opts.priority ?? 0,
        opts.maxAttempts ?? 3,
        opts.dedupeKey ?? null,
        now + (opts.delayMs ?? 0),
        now,
      );
    return info.changes > 0 ? Number(info.lastInsertRowid) : undefined;
  }

  claim(): JobRow | undefined {
    const row = this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'running', started_at = @now, attempts = attempts + 1
         WHERE id = (
           SELECT id FROM jobs WHERE status = 'pending' AND available_at <= @now
           ORDER BY priority DESC, id ASC LIMIT 1
         )
         RETURNING id, type, payload, status, attempts, max_attempts AS maxAttempts`,
      )
      .get({ now: Date.now() }) as RawJobRow | undefined;

    if (!row) return undefined;
    return { ...row, payload: JSON.parse(row.payload) as unknown };
  }

  complete(id: number): void {
    this.sqlite
      .prepare(`UPDATE jobs SET status = 'succeeded', finished_at = ?, error = NULL WHERE id = ?`)
      .run(Date.now(), id);
  }

  fail(job: JobRow, error: Error): void {
    const now = Date.now();
    const detail = error.stack ?? error.message;
    if (job.attempts >= job.maxAttempts) {
      this.sqlite
        .prepare(`UPDATE jobs SET status = 'dead', finished_at = ?, error = ? WHERE id = ?`)
        .run(now, detail, job.id);
      return;
    }
    const backoff = Math.min(RETRY_BASE_MS * 2 ** (job.attempts - 1), RETRY_MAX_MS);
    this.sqlite
      .prepare(`UPDATE jobs SET status = 'pending', available_at = ?, error = ? WHERE id = ?`)
      .run(now + backoff, detail, job.id);
  }

  retry(jobId: number): boolean {
    const info = this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'pending', available_at = ?, attempts = 0, error = NULL WHERE id = ? AND status IN ('failed', 'dead')`,
      )
      .run(Date.now(), jobId);
    return info.changes > 0;
  }

  /** 取消某媒体的未完成作业（「跳过 AI」时用，避免 AI 任务在用户决定后被领走） */
  cancelForMedia(mediaId: number, reason: string): number {
    const info = this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'dead', finished_at = ?, error = ?
         WHERE status IN ('pending', 'running') AND json_extract(payload, '$.mediaId') = ?`,
      )
      .run(Date.now(), reason, mediaId);
    return info.changes;
  }

  resetStale(staleMs = STALE_RUNNING_MS): number {
    const now = Date.now();
    const info = this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'pending', available_at = ? WHERE status = 'running' AND started_at < ?`,
      )
      .run(now, now - staleMs);
    if (info.changes > 0) {
      this.logger.warn({ count: info.changes }, '重置僵死 running 任务为 pending');
    }
    return info.changes;
  }

  counts(): Record<string, number> {
    const rows = this.sqlite
      .prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`)
      .all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}
