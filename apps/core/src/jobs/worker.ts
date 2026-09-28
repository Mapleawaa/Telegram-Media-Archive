import type { Logger } from 'pino';
import type { EventBus } from '../events/bus.js';
import type { JobQueue, JobRow } from './queue.js';

export type JobHandler = (payload: unknown, job: JobRow) => Promise<void>;

const POLL_INTERVAL_MS = 200;

export class Worker {
  private readonly handlers = new Map<string, JobHandler>();
  private timer?: NodeJS.Timeout;
  private inFlight = 0;
  private ticking = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly concurrency = 4,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.logger.info({ concurrency: this.concurrency }, '作业 worker 已启动');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async drain(timeoutMs = 5_000): Promise<void> {
    const start = Date.now();
    while (this.inFlight > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      while (this.inFlight < this.concurrency) {
        const job = this.queue.claim();
        if (!job) break;
        this.inFlight += 1;
        void this.run(job).finally(() => {
          this.inFlight -= 1;
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async run(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.fail(job, new Error(`未注册的任务类型: ${job.type}`));
      return;
    }
    const started = Date.now();
    try {
      await handler(job.payload, job);
      this.queue.complete(job.id);
      this.logger.debug({ jobId: job.id, type: job.type, ms: Date.now() - started }, 'job 完成');
    } catch (err) {
      this.fail(job, err);
    }
  }

  private fail(job: JobRow, err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.queue.fail(job, error);
    this.logger.warn({ jobId: job.id, type: job.type, err: error.message }, 'job 失败');
    this.bus.emit('job.failed', { jobId: job.id, type: job.type, error: error.message }, 'system');
  }
}
