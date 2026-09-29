import { createApp } from './bootstrap';
import { configProblems } from './common/config-check';
import { logger } from './common/logger';

async function main() {
  const problems = configProblems();
  if (problems.length) {
    logger.fatal({ problems }, 'refusing to start: insecure production configuration');
    process.exit(1);
  }
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  // Only the website (same machine or a reverse proxy) should reach the API directly.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  logger.info({ port, host }, 'api listening');
}

main().catch((err) => {
  logger.fatal({ err }, 'api failed to start');
  process.exit(1);
});
