import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../database/test-utils.js';
import { JobQueue } from './queue.js';

const logger = pino({ level: 'silent' });

function makeQueue() {
  const { sqlite } = createTestDb();
  return { queue: new JobQueue(sqlite, logger), sqlite };
}

describe('JobQueue', () => {
  it('入队后可按优先级 claim，完成后状态为 succeeded', () => {
    const { queue, sqlite } = makeQueue();
    queue.enqueue('a.low', { n: 1 }, { priority: 0 });
    queue.enqueue('b.high', { n: 2 }, { priority: 10 });

    const job = queue.claim();
    expect(job?.type).toBe('b.high');
    expect(job?.payload).toEqual({ n: 2 });
    expect(job?.attempts).toBe(1);

    queue.complete(job!.id);
    const row = sqlite.prepare(`SELECT status FROM jobs WHERE id = ?`).get(job!.id) as {
      status: string;
    };
    expect(row.status).toBe('succeeded');
  });

  it('claim 在两次调用间不会返回同一个任务', () => {
    const { queue } = makeQueue();
    queue.enqueue('t', {});
    const first = queue.claim();
    const second = queue.claim();
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  it('相同 dedupe_key 的活动任务不会重复入队，完成后可再次入队', () => {
    const { queue } = makeQueue();
    const id1 = queue.enqueue('ai.enrich', { mediaId: 1 }, { dedupeKey: 'ai.enrich:1' });
    const id2 = queue.enqueue('ai.enrich', { mediaId: 1 }, { dedupeKey: 'ai.enrich:1' });
    expect(id1).toBeDefined();
    expect(id2).toBeUndefined();

    const job = queue.claim()!;
    queue.complete(job.id);
    const id3 = queue.enqueue('ai.enrich', { mediaId: 1 }, { dedupeKey: 'ai.enrich:1' });
    expect(id3).toBeDefined();
  });

  it('失败后按退避延迟重试，超过 maxAttempts 进入 dead', () => {
    const { queue, sqlite } = makeQueue();
    queue.enqueue('flaky', {}, { maxAttempts: 2 });

    const first = queue.claim()!;
    queue.fail(first, new Error('boom 1'));
    expect(queue.claim()).toBeUndefined();

    sqlite.prepare(`UPDATE jobs SET available_at = 0 WHERE id = ?`).run(first.id);
    const second = queue.claim()!;
    expect(second.attempts).toBe(2);
    queue.fail(second, new Error('boom 2'));

    const row = sqlite.prepare(`SELECT status, error FROM jobs WHERE id = ?`).get(first.id) as {
      status: string;
      error: string;
    };
    expect(row.status).toBe('dead');
    expect(row.error).toContain('boom 2');
  });

  it('resetStale 把超时 running 任务重置为 pending', () => {
    const { queue, sqlite } = makeQueue();
    queue.enqueue('stuck', {});
    const job = queue.claim()!;
    sqlite.prepare(`UPDATE jobs SET started_at = ? WHERE id = ?`).run(Date.now() - 60_000, job.id);

    const reset = queue.resetStale(10 * 60_000);
    expect(reset).toBe(0);

    const reset2 = queue.resetStale(30_000);
    expect(reset2).toBe(1);
    expect(queue.claim()?.id).toBe(job.id);
  });

  it('retry 可把 dead 任务复活为 pending', () => {
    const { queue } = makeQueue();
    queue.enqueue('x', {}, { maxAttempts: 1 });
    const job = queue.claim()!;
    queue.fail(job, new Error('nope'));

    expect(queue.retry(job.id)).toBe(true);
    const again = queue.claim()!;
    expect(again.id).toBe(job.id);
    expect(again.attempts).toBe(1);
  });
});
