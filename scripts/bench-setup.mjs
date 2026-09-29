// Phase 19: builds a separate benchmark database (rupeemap_bench) with 100,000 cases,
// so speed can be measured without touching the live demo data.
// Usage (local DB running): node scripts/bench-setup.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'node_modules', '.pnpm', 'node_modules', 'x.js'));
const { Client } = require('pg');
const base = 'postgresql://rupeemap:rupeemap_dev@127.0.0.1:5433';
const url = `${base}/rupeemap_bench`;

const admin = new Client({ connectionString: `${base}/rupeemap_dev` });
await admin.connect();
await admin.query('DROP DATABASE IF EXISTS rupeemap_bench');
await admin.query('CREATE DATABASE rupeemap_bench');
await admin.end();

const api = path.join(root, 'apps', 'api');
const env = { ...process.env, DATABASE_URL: url };
execSync('npx prisma migrate deploy', { cwd: api, env, stdio: 'pipe' });
execSync('npx tsx prisma/seed.ts', { cwd: api, env, stdio: 'pipe' });

const c = new Client({ connectionString: url });
await c.connect();
const t = Date.now();
const res = await c.query(readFileSync(path.join(root, 'scripts', 'bench-data.sql'), 'utf8'));
const last = Array.isArray(res) ? res[res.length - 1] : res;
console.log('bench data loaded in', Math.round((Date.now() - t) / 1000), 's', last.rows[0]);
await c.end();
