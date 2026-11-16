# GetBlitz shutdown log

No secrets, tokens, or email addresses in this file. Times are Europe/Berlin.

Planned SHUTDOWN_AT: Thu 2026-11-19 12:00 CET (must be ≥48h after the notice emails are sent).

## Stage 0 — Recon (read-only) — 2026-11-16

- Repo inspected at `286611a` (branch `claude/getblitz-shutdown-staged-6wskdo`). No code changes.
- Coolify (read-only API calls only): project `GetBlitz` (d4cw4o8wkswk88wk80044g8w).
  - app `getblitz-io-apps` (hy5ifixzasfpycsiggyptajs), app.getblitz.io, server `coolify-apps`, branch `main`, post-deploy `pnpm db:push`.
    Description says "Rehearsal clone; temporary domain until cutover" → open question for the operator.
  - app `Website` (rjdcllp6unds5vcaz66ci9v9), getblitz.io + www, server `localhost`, branch `main`.
  - db `getblitz-postgres-apps` (pjieqqosqag6oavjx70ztuux), postgres:17, not public, daily backup to S3, 7 kept locally.
  - db `getblitz-redis-apps` (bvdwvlttxc0rvt3eartno5ie), redis:7.2.
  - GetBlitz has its own DB + Redis (not shared). The servers `coolify-apps` and `localhost` ARE shared (Semantik, Sprachflow, insure365): do not touch.
- Docs: GitHub Pages (`deploy-docs.yml`), docs.getblitz.io. Demo + test-bank: not deployed in Coolify.
- npm: `@getblitz/client@0.0.10`, `@getblitz/shared-types@0.0.12` published.
- Stripe: the only visible Stripe account is Sprachflow's; not queried. GetBlitz code has no billing.
- DB queries: NOT run (no DB access from this session). Prepared `shutdown/sql/stage0_recon.sql` (read-only, no PII output).
- STATUS: waiting at GATE 0.
- 2026-11-16: operator ran `stage0_recon.sql` in DBeaver → syntax error at `\echo` (psql-only meta-command); nothing executed, no writes.
  Added `stage0_recon_dbeaver.sql` (single read-only SELECT). Verified against a scratch Postgres built from the repo migrations with fake data.
