import path from 'node:path';
import { z } from 'zod';

try {
  process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'));
} catch {
  // 无 .env 文件时依赖真实环境变量（CI / 生产）
}

const EnvSchema = z.object({
  TG_BOT_TOKEN: z.string().min(10, 'TG_BOT_TOKEN 看起来不是有效的 Bot Token'),
  TG_ARCHIVE_CHAT_ID: z.coerce.number().int(),
  TELEGRAM_PROXY_URL: z.string().url().optional(),
  CORE_HOST: z.string().default('127.0.0.1'),
  CORE_PORT: z.coerce.number().int().positive().default(8787),
  TMA_DATA_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['auto', 'none', 'mock', 'openai']).default('auto'),
  AI_CHAT_MODEL: z.string().optional(),
  AI_VLM_MODEL: z.string().optional(),
  AI_EMBED_MODEL: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & { dataDir: string };

export function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(
      `[config] 环境变量校验失败：\n${issues}\n请检查 apps/core/.env（可从 .env.example 复制）`,
    );
    process.exit(1);
  }
  const env = parsed.data;
  const dataDir = env.TMA_DATA_DIR
    ? path.resolve(env.TMA_DATA_DIR)
    : path.join(import.meta.dirname, '..', '.data');
  return { ...env, dataDir };
}

export function redactConfig(config: AppConfig): Record<string, unknown> {
  const { TG_BOT_TOKEN, AI_API_KEY, ...rest } = config;
  return {
    ...rest,
    TG_BOT_TOKEN: TG_BOT_TOKEN ? '[set]' : '[missing]',
    AI_API_KEY: AI_API_KEY ? '[set]' : '[missing]',
  };
}
