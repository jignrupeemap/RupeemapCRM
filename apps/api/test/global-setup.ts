import { execSync } from 'child_process';

/**
 * Apply migrations and the idempotent seed to the test database. Nothing is
 * wiped: every run uses fresh mobile numbers, so runs never collide.
 */
export default async function setup() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/rupeemap_test',
  };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });
}
