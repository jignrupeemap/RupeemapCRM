# Rupeemap CRM

Loan DSA CRM for Rupeemap: case logins, workflow (Login → Sanction → Disbursed → Handover), automatic partner payouts, team hierarchy, KYC gate and audit trail.

## Stack

- `packages/shared` shared zod schemas, roles, permissions, workflow rules, INR formatting
- `apps/api` NestJS 11 + Prisma 6 (PostgreSQL) + Redis
- `apps/web` Next.js 15 + Tailwind + TanStack Query

## Run locally

Requires Node 20+, pnpm 10, PostgreSQL 16 and Redis 7.

```bash
docker compose -f infra/docker-compose.yml up -d   # or use your own Postgres/Redis
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm build                  # builds shared package
pnpm db:migrate
pnpm db:seed                # demo users, banks, projects, sliders (refuses in production)
pnpm dev:api                # http://localhost:4000/api/v1
pnpm dev:web                # http://localhost:3000
node scripts/demo-cases.mjs # optional: 12 demo cases with payouts
```

## Demo logins (password `Rupeemap@123`)

| Role | Mobile |
| --- | --- |
| Admin (Jignesh Patel) | 9000000001 |
| Admin Executive (Priya Shah) | 9000000002 |
| DSA Partner (Mehul Desai) | 9000000003 |
| Team Partner (Ravi Parmar) | 9000000004 |
| Team Partner (Nisha Joshi) | 9000000005 |

In development, OTP SMS go to the console and the login screen shows the last OTP sent.

## Tests

```bash
pnpm --filter @rupeemap/api test  # integration tests against rupeemap_test database
```

Architecture and decisions: `docs/PHASE-0-ARCHITECTURE.md`.
