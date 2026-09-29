import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { pino, multistream, type Logger } from 'pino';

// pino-pretty 是 CJS 且用 export =，用 createRequire 拿到可调用工厂（ESM 下类型/运行时都稳）
const require_ = createRequire(import.meta.url);
const prettyFactory = require_('pino-pretty') as typeof import('pino-pretty');

const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 8) secrets.add(value);
}

function sanitizeString(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (value instanceof Error) {
    const clone = new Error(sanitizeString(value.message));
    clone.name = value.name;
    if (value.stack) clone.stack = sanitizeString(value.stack);
    for (const key of Object.keys(value)) {
      if (key === 'message' || key === 'stack') continue;
      (clone as unknown as Record<string, unknown>)[key] = sanitizeValue(
        (value as unknown as Record<string, unknown>)[key],
        depth + 1,
      );
    }
    return clone;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeValue(v, depth + 1));
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v, depth + 1);
    return out;
  }
  return value;
}

const RETAIN_DAYS = 14;

/**
 * 按天轮转的日志文件流（P5-6 / D4）：
 * 写 `<dir>/core-YYYY-MM-DD.log`，跨天自动换文件；保留最近 RETAIN_DAYS 天。
 * 只在 core 常驻进程里启用（`createLogger` 的 fileDir 参数），测试/冒烟不落盘。
 */
class DailyFileStream extends Writable {
  private readonly dir: string;
  private current: { day: string; stream: fs.WriteStream } | null = null;

  constructor(dir: string) {
    super({ objectMode: true });
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cleanOld();
  }

  private cleanOld(): void {
    const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
    try {
      for (const name of fs.readdirSync(this.dir)) {
        const m = /^core-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
        if (!m?.[1]) continue;
        if (new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
          fs.rmSync(path.join(this.dir, name), { force: true });
        }
      }
    } catch {
      // 清理失败不影响日志主链路
    }
  }

  override _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (!this.current || this.current.day !== day) {
        this.current?.stream.end();
        this.current = {
          day,
          stream: fs.createWriteStream(path.join(this.dir, `core-${day}.log`), { flags: 'a' }),
        };
      }
      this.current.stream.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Buffer));
      cb();
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _final(cb: (err?: Error | null) => void): void {
    this.current?.stream.end();
    this.current = null;
    cb();
  }
}

/**
 * 返回类型统一收敛到 pino 的默认 Logger：
 * pino 的泛型在「有无 stream」两种构造下不同（Logger<never> vs Logger<string>），
 * 这里做一次显式收口，调用方拿到的始终是同一个类型（运行时无差别）。
 */
export function createLogger(level: string, pretty: boolean, fileDir?: string): Logger {
  const base = {
    level,
    redact: {
      paths: [
        '*.TG_BOT_TOKEN',
        '*.token',
        '*.apiKey',
        '*.AI_API_KEY',
        'req.headers.authorization',
      ],
      censor: '[redacted]',
    },
    hooks: {
      logMethod(args: unknown[], method: (...a: unknown[]) => void) {
        const sanitized = (args as unknown[]).map((a) => sanitizeValue(a));
        return method.apply(this as never, sanitized as never);
      },
    },
  };

  // 不落盘（测试 / 冒烟 / 显式关闭）：保持旧行为（transport 走 worker 线程，仅 stdout）
  if (!fileDir) {
    return pino({
      ...base,
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          }
        : undefined,
    });
  }

  // 落盘 + 控制台双写：文件是 JSON 行（便于检索），控制台按开发模式决定是否美化
  const streams = [
    { level, stream: new DailyFileStream(fileDir) },
    {
      level,
      stream: pretty
        ? prettyFactory({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' })
        : process.stdout,
    },
  ];
  return pino(base, multistream(streams));
}
