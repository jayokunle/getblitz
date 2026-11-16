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
- 2026-11-16 16:33: recon results received (DBeaver CSV, not committed). 30 users, 30 orgs, 34 sessions, 27 bank connections.
  **STOP condition hit:** non-owner orgs with live bank credentials:
  `peptideplein-2-niew` (Wise CONNECTED, credentials + webhook + 1 bank account) and
  `peptideplein247` (Qonto NEEDS_REAUTH, credentials + webhook + 1 bank account). All other non-owner connections EXPIRED with no credentials.
- Email: no SMTP/mail env on any GetBlitz resource. SMTP_* exists on Sprachflow `api-apps` and Semantik `semantik-prod:api-apps` (key names only checked; values not read).
- Network: getblitz.io (302), app.getblitz.io/api/version (200), docs (200) reachable from session.
- STATUS: STOPPED at GATE 0, waiting for operator decision. No changes made.
- 2026-11-16: operator decisions at GATE 0:
  - Live bank access (peptideplein-2-niew Wise, peptideplein247 Qonto): notify now; at Stage 4 delete bank-side webhooks via API where possible, then delete stored tokens. Email asks merchant to revoke access in Wise/Qonto.
  - Group A = `peptideplein247`, `peptideplein-2-niew` (2 orgs).
  - Kept as operator's own (not emailed, not deleted): `jayokunle`, `test`, `test4325`.
  - Not emailed (spam): `httpswhopcomcheckoutplan-…` (deleted at Stage 4).
  - Group B = remaining 24 orgs + 1 user with no org. Recipient addresses de-duplicated at send time.
  - Sender + reply-to: hello@jayokunle.com (approved by operator).
  - SMTP: operator says it is in Coolify team shared env; to be referenced from getblitz-io-apps.

## Stage 1 — Stop signups — 2026-11-16 (operator "go")

- PR jayokunle/getblitz#67: server-side signup lock (`DISABLE_SIGNUPS`), org-creation block, banners (`SHUTDOWN_BANNER` on app; hardcoded en/de/fr on website), website CTAs → GitHub/docs.
- Verified locally against scratch DB: email sign-up blocked; Google new-user sign-up blocked; existing-user session OK; org creation blocked.
- Coolify `getblitz-io-apps` env set: `DISABLE_SIGNUPS=true`, `SHUTDOWN_BANNER` (takes effect on next deploy).
- CI: typecheck/test/format green; E2E fails at Playwright install (ubuntu 26.04 runner), same failure on main since 2026-11-02 — pre-existing.
- Stage 2 email drafts written: `shutdown/emails/group-a.txt`, `group-b.txt` (not sent).
- 2026-11-16 16:13 UTC: SMTP env added to `getblitz-io-apps` (runtime only): SMTP_HOST/PORT/USER/PASSWORD as `{{team.*}}` references (provider: Mailjet), SMTP_FROM=no-reply@getblitz.io, SMTP_REPLY_TO=hello@jayokunle.com.
  **Incident:** the Coolify API response echoed the resolved SMTP credentials into the agent session transcript (not into chat/log/files). Recommended: rotate the Mailjet API key after Stage 2 and update the team shared variable.
  To check before sending: no-reply@getblitz.io must be an authorised sender in Mailjet, and getblitz.io SPF/DKIM must include Mailjet.

### Stage 1 — production verification (2026-11-16 ~16:45 UTC)
- Deploys finished: getblitz-io-apps @16e8b70 (16:33 UTC) and @ef03756 incl. mailer (16:42 UTC); Website @16e8b70 (16:35 UTC).
- getblitz.io → www.getblitz.io/en: banner present; 0 links to app.getblitz.io; CTAs → GitHub; SaaS plan "discontinued".
- app.getblitz.io/sign-in: banner present.
- POST /api/auth/sign-up/email → 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`.
- POST /api/auth/sign-in/social (google) → redirect to accounts.google.com (existing users can still sign in).
- New Google account → refused in OAuth callback (verified locally against the same code; prod check with a fresh Google account is for the operator).
- /pay/* public page: no banner. Mailer endpoint: 404 (SHUTDOWN_NOTICE_SECRET not set yet).
- PR jayokunle/getblitz#69 (mailer) merged; endpoint dormant until secret is set.
- Screenshots kept outside the repo (agent scratchpad).
