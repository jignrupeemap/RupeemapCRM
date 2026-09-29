# Running Rupeemap CRM on this PC

Everything stays inside the `Rupeemap.claude` folder: packages, caches (`.cache/`, `.pnpm-store/`) and the local database (`.cache/pgdata`).

**Easiest:** double-click `START-RUPEEMAP.bat` in this folder. It starts everything and opens the login page. Keep its small black windows open while you use the CRM.

To start the parts by hand instead, open a terminal in the folder and run each in its own window:

```bash
node scripts/local-db.mjs
```

```bash
cd apps/api && npx tsc -p tsconfig.build.json && node --env-file=.env dist/main.js
```

```bash
cd apps/web && npx next build && npx next start -p 3000
```

Then open http://localhost:3000 and sign in with a demo login from `HANDOFF.md` (password `Rupeemap@123`).

## Notes
- The local database runs on port 5433 so it never touches your own PostgreSQL service. To use your own PostgreSQL instead, change `DATABASE_URL` in `apps/api/.env`.
- `REDIS_URL=memory://` keeps sessions and rate limits in memory; restarting the API signs everyone out. Production uses real Redis.
- The partner inactivity check runs automatically once a day when the API is running. Admin can also run it from Inactive Partners.
- Demo data: `node scripts/demo-cases.mjs` (12 cases) and, from `apps/api`, `node --env-file=.env prisma/demo-inactive.mjs` (four partners with old activity dates).
- Tests: from `apps/api`, `TEST_DATABASE_URL=postgresql://rupeemap:rupeemap_dev@127.0.0.1:5433/rupeemap_test npx vitest run`.
