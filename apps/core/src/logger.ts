import { pino, type Logger } from 'pino';

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

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
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
      logMethod(args, method) {
        const sanitized = (args as unknown[]).map((a) => sanitizeValue(a));
        return method.apply(this, sanitized as Parameters<typeof method>);
      },
    },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
  });
}
