# Rupeemap CRM handoff (cloud thread, 2026-09-28)

Archive: `rupeemap-crm-src.tar.gz` (pnpm monorepo, without node_modules/.next/dist/.env). The same tree is unpacked in `code/`.
Blueprint and decisions: `docs/PHASE-0-ARCHITECTURE.md` (spec text in `docs/spec-extract.txt`).

## Done (Phases 1–6)
- Auth: mobile + password, OTP activation/reset (console SMS in dev; the login page shows the last OTP), server sessions (httpOnly cookie, Redis cache), revoke on block, password change or promotion
- Users: create DSA/TP/Executive, payout % rates, block/reset/promote, permission overrides, KYC approve/reject, team hierarchy
- Cases: 4-step create wizard with duplicate check; SANCTION / DISBURSE (tranches) / HANDOVER / RAISE+RESOLVE QUERY / REJECT / WITHDRAW / REOPEN; corrections; remarks; row locks, optimistic version and Idempotency-Key
- Payouts: created at Handover (DSA line plus TP line), PENDING→CONFIRMED→PAID/HOLD, KYC gate, UTR, received-from-bank flag
- Dashboards for each role, notifications, Project Master, Banker Directory, sliders, brand logo and palette
- Hash-chained audit log; DB triggers make history tables append-only
- Tests: `apps/api/test/lifecycle.spec.ts`, 21/21 passing (DB `rupeemap_test`, Redis db 1)

## Run
```
docker compose -f infra/docker-compose.yml up -d
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm dev:api    # :4000/api/v1
pnpm dev:web    # :3000
node scripts/demo-cases.mjs   # optional: 12 demo cases
```
The API dev script compiles with tsc and then runs node, because tsx has no decorator metadata.

## Demo logins (password Rupeemap@123)
| Role | Name | Mobile |
| --- | --- | --- |
| Admin | Jignesh Patel | 9000000001 |
| Executive | Priya Shah | 9000000002 |
| DSA | Mehul Desai | 9000000003 |
| TP | Ravi Parmar | 9000000004 |
| TP | Nisha Joshi | 9000000005 |

## Half-built / next
- Placeholder "Soon" pages: Checklist (Phase 8), Bankwise Code (12), Raise Query and Need Assistance (13), Audit Log UI (17)
- Case detail tabs Documents/Checklist/Insurance/Recovery/Assistance are placeholders
- Not started: KYC document upload and S3 storage (Phase 9), BullMQ jobs, a real SMS provider, exports and reports
- Continue from Phase 7 in PART 101 order, with a phase report after each phase
