import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { settings } from '../database/schema.js';
import type { SettingsMap } from '@tma/shared';

export function getSetting<T>(ctx: AppContext, key: string): T | undefined {
  const row = ctx.db.select().from(settings).where(eq(settings.key, key)).get();
  return row ? (row.value as T) : undefined;
}

export function setSetting(ctx: AppContext, key: string, value: unknown): void {
  ctx.db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .run();
}

export function allSettings(ctx: AppContext): SettingsMap {
  const rows = ctx.db.select().from(settings).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
