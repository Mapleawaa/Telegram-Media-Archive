import { SettingsPatchSchema } from '@tma/shared';
import type { AppServer } from '../types.js';
import type { AppContext } from '../../context.js';
import { allSettings, setSetting } from '../../settings/store.js';

export function registerSettingsRoutes(app: AppServer, ctx: AppContext): void {
  app.get('/api/settings', async () => ({
    settings: allSettings(ctx),
    archiveChatId: ctx.config.TG_ARCHIVE_CHAT_ID,
    dataDir: ctx.config.dataDir,
  }));

  app.patch('/api/settings', async (req, reply) => {
    const { key, value } = SettingsPatchSchema.parse(req.body ?? {});
    if (key === 'archive_chat_id') {
      return reply
        .status(400)
        .send({ error: 'read_only', message: '归档群 ID 来自 .env，请在配置文件中修改' });
    }
    setSetting(ctx, key, value);
    return { ok: true, key, value };
  });
}
