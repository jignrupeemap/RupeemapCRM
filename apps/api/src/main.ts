import { createApp } from './bootstrap';
import { logger } from './common/logger';

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.info({ port }, 'api listening');
}

main().catch((err) => {
  logger.fatal({ err }, 'api failed to start');
  process.exit(1);
});
