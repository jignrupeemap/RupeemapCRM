# Rupeemap CRM security

This file explains what protects the CRM and what must be set before it goes live.

## What is already in place

**Sign-in**
- Passwords are stored with Argon2id and are never saved as plain text.
- Accounts lock after repeated wrong passwords. Sign-in and OTP requests are rate-limited per phone number and per IP address.
- New passwords need at least 8 characters with a letter and a number. Common passwords such as `Password@123` or `Rupeemap@123` are refused.

**Sessions**
- The session cookie is httpOnly (web pages cannot read it) and SameSite (other websites cannot send it).
- Sessions expire 2 hours after sign-in for Admin and Admin Executive, and 12 hours for partners.
- Sessions also end after a period of no activity: 30 minutes for Admin and Admin Executive, 2 hours for DSA Partners and Team Partners.
- When a person is blocked, deactivated or has their password reset, all of their sessions end at once.

**Cross-site protection**
- Every change must carry the CRM's own request header, so a form on another website cannot act as a signed-in user.
- After sign-in, the CRM only returns you to one of its own pages.

**Access rules**
- The server checks permissions and data scope on every request. For example, a DSA only ever sees their own team's cases, payouts and reports.
- Hiding a button in the website is only for convenience; it is not what protects the data.

**Files**
- File type is checked from the file's content, not from its name.
- Files are encrypted at rest with AES-256-GCM and are never cached.
- Every view of a file is recorded in the audit log.
- Download names are cleaned, so Gujarati or Hindi file names download correctly.

**Web pages**
- A Content Security Policy is set.
- The CRM cannot be shown inside another website's frame (frame-ancestors none, X-Frame-Options DENY).
- HSTS is set, which forces HTTPS once the CRM is live.
- The browser is told not to guess file types (nosniff), and camera, microphone and location access are turned off.

**API**
- Responses are marked `no-store`, so private and financial data is not kept in browser or proxy caches.
- The API listens only on this computer (`HOST=127.0.0.1`), and the website passes requests to it.

**Audit**
- Every important action goes into an append-only log. Each entry is chained to the one before it with a hash.
- The database blocks edits and deletes to the log.
- Admin can run a tamper check on the Audit Log screen.

**Exports**
- Exports are rate-limited and every export is recorded in the audit log.
- Spreadsheet formulas in exported text are neutralised, so a cell cannot run a formula when opened.

## Before going live (the API refuses to start otherwise)

| Setting | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `FILE_ENCRYPTION_KEY` | 64 random hex characters. Back it up safely: without it, uploaded documents cannot be read. |
| `OTP_PEPPER` | A random value of at least 32 characters |
| `DATABASE_URL` | A dedicated production database user with a strong password |
| `REDIS_URL` | A real Redis server, not `memory://` |
| `WEB_ORIGIN` | Only `https://` addresses |
| `SMS_PROVIDER` | A real SMS gateway, not `console` |

Also set:
- `TRUST_PROXY_HOPS`: the number of proxies in front of the API. The default is 1 (the website).
- `HOST`: keep `127.0.0.1` unless a reverse proxy on another machine needs to reach the API.

Before launch, also change or remove every demo account created by the seed files.

## Known, accepted items

`pnpm audit --prod` reports one issue in `deepmerge-ts`. It is used only by the Prisma command-line tool while building or migrating the database, never by the running CRM. It will be resolved when Prisma is upgraded.

PostCSS, which Next.js uses only at build time, is pinned to a fixed version.
