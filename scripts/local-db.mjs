// Starts a throwaway PostgreSQL 17 for development and tests, stored inside this
// project folder (.cache/pgdata) on port 5433, so nothing outside the folder is used.
// Usage: node scripts/local-db.mjs   (Ctrl+C to stop)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = path.join(root, '.cache', 'pgdata');
const port = Number(process.env.LOCAL_DB_PORT ?? 5433);

const pg = new EmbeddedPostgres({ databaseDir, user: 'rupeemap', password: 'rupeemap_dev', port, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });

const fresh = !existsSync(path.join(databaseDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
for (const db of ['rupeemap_dev', 'rupeemap_test']) {
  try {
    await pg.createDatabase(db);
  } catch {
    // already exists
  }
}
console.log(`Local PostgreSQL ready on port ${port}: postgresql://rupeemap:rupeemap_dev@127.0.0.1:${port}/rupeemap_dev`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
