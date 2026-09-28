import { pino, type Logger } from 'pino';

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
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
  });
}
