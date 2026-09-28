import { createServer } from './api/server.js';
import { loadConfig, redactConfig } from './config.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, process.env.NODE_ENV !== 'production');

const app = await createServer(config, logger);

try {
  await app.listen({ host: config.CORE_HOST, port: config.CORE_PORT });
  logger.info(redactConfig(config), `core 已启动：http://${config.CORE_HOST}:${config.CORE_PORT}`);
} catch (err) {
  logger.error(err, 'core 启动失败');
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`收到 ${sig}，正在退出…`);
    void app.close().then(() => process.exit(0));
  });
}
