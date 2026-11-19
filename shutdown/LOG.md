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

## Stage 2 — Notice emails

- 2026-11-16 ~16:50 UTC: operator set SHUTDOWN_NOTICE_SECRET (value never seen by the agent). Coolify "restart" failed twice (Coolify helper-container bug on apps with a separate build server, app kept running); redeploy without rebuild applied the env. Endpoint now 401 without secret.
- Runner: disabled Coolify scheduled task `cqe5ktjbo0nwq8m7lotiuc0w` on getblitz-io-apps, executed on demand (commands limited to ~255 chars).
- 16:55 UTC dry-run: total 26 — Group A 1 (orgs peptideplein247, peptideplein-2-niew), Group B 25 (24 orgs + 1 user without org); excluded 3 owner users, 1 spam user. alreadySent 0.
- 16:55 UTC test: both notices sent to the owner of `jayokunle` only; Mailjet accepted both (status sent).
- STATUS: waiting at GATE 2 (wording, sender, counts). No recipient e-mails sent.
- 2026-11-16T16:57Z: operator confirmed both test e-mails arrived in the inbox (not spam). Still waiting for wording approval + "go".
- 2026-11-16 17:00 UTC (18:00 CET): GATE 2 approved by operator ("wording approved, go"). Pre-send dry-run: 26 (A 1, B 25), alreadySent 0.
- 17:00:09–17:00:51 UTC: send run complete — **26 sent, 0 failed, 0 retries** (A 1/1, B 25/25). Per-recipient log (hash refs + org slugs, no addresses): `shutdown/stage2-send-report.json`.
- Notice sent 2026-11-16 18:00 CET → SHUTDOWN_AT Thu 2026-11-19 12:00 CET is ~66 h later (≥ 48 h requirement met). SHUTDOWN_AT unchanged.

## Stage 3 — Pre-shutdown prep (started 2026-11-19 17:10 UTC, after SHUTDOWN_AT)

- NOTE: SHUTDOWN_AT (2026-11-19 12:00 CET) passed before Stage 3 started; service still fully running, nothing irreversible done.
- PR jayokunle/getblitz#70 merged (e13f233): BLOCK_NEW_PAYMENT_SESSIONS flag, POST /api/internal/shutdown (plan/revoke-banks/delete-keys/purge; dry run unless execute+token), shutdown/run.sh, shutdown/backup.sh, static notice + nginx config, docs Pages notice workflow. Verified end to end on a scratch DB (see PR).
- Coolify backup run now (server-side, also copied to S3, not client-side encrypted): `production` DB 90,141 bytes at 17:24 UTC (exec sfutal57dgqjz5267kxp4x9n). Previous: 00:00 UTC same day.
- DB server holds 3 databases: `production` (GetBlitz data), `preview` (empty), `postgres` (default).
- Notice app created in Coolify: `getblitz-shutdown-notice` (fsdrun4h4q5q0me7ouvrg80z), project GetBlitz, server coolify-apps, static build from shutdown/notice, custom nginx config set, NO domains (not public).
- docs.getblitz.io = GitHub Pages behind Cloudflare → step 5 swaps the Pages workflow (shutdown/deploy-docs-notice.yml), no DNS change.

## Stage 4 — Shutdown (GATE 3 approved 2026-11-19 ~17:53 UTC)

- Operator: "I have backed up the DB, you can just go for stage 4". Operator-reported backup (restore-check output not shared with agent) + Coolify backup of `production` at 17:24 UTC (S3).
- Defaults accepted as presented at GATE 3: keep orgs jayokunle/test/test4325 + their 3 users; delete ALL API keys + merchant webhooks (incl. own); kept payment sessions untouched (incl. client tokens); DB + Redis keep running.
- 2026-11-19T17:54Z step 1: BLOCK_NEW_PAYMENT_SESSIONS=true set on getblitz-io-apps; redeploy oxvqsq9vepv080x2jtki2gw5 queued (no rebuild).
- 17:56 UTC step 1 verified: blockNewPaymentSessions "true" (flag returns raw string; an explicit "false" would also be truthy — cleanup item), in-flight sessions 0.
- 17:57 UTC step 2 revoke-banks (REVOKE-BANKS-5): stored credentials/config/webhook secrets wiped on all 5 connections (rows kept, status DISCONNECTED).
  - peptideplein-2-niew / wise: webhook DELETED at Wise; API token → manual (merchant asked in notice e-mail).
  - jayokunle / qonto: webhook lookup FAILED (Qonto 401, grant already expired); revoke call sent without error (RFC 7009 returns OK even for dead tokens) → MANUAL: operator revokes GetBlitz app + webhook in Qonto.
  - peptideplein247 / qonto (NEEDS_REAUTH): same as above → MANUAL on merchant side (asked in notice e-mail).
  - owner / qonto (EXPIRED), peptideplein247 / qonto (EXPIRED): config only, wiped; nothing at bank.
  - Coolify log redaction hid the per-connection "token" field.
- 17:57 UTC step 3 delete-keys (DELETE-KEYS-12): organization_webhook 3 deleted; apikey deleted (count redacted by Coolify; post-check apiKeys = 0).
- 17:57 UTC step 4 purge (PURGE-27), one transaction — deleted rows: organization 27, user 27, member 27, account 27, session 29, organization_bank_account 24, bank_account 2, payment_session 7, customer 1, apikey (redacted, 0 left), organization_webhook 0, invoice 0, transaction 0, invitation 0, verification 0.
  keptUnchanged = true (kept orgs jayokunle/test/test4325: payment_session 27 [PAID 8], transaction 8, bank_account 1).
- 17:58 UTC post-check plan: bank secrets 0, apiKeys 0, webhooks 0, nothing left to purge.
- 17:58 UTC step 5 notice: domains removed from getblitz-io-apps (was https://app.getblitz.io) and Website (was https://getblitz.io,https://www.getblitz.io); set on notice apps `getblitz-shutdown-notice-app` (30pk0mvzdchbrzni2euhepa7, coolify-apps, nginx:1.27-alpine + mounted notice files; registry push for a new image was denied) and `getblitz-shutdown-notice-website` (z8c8hnfaynca1qdmgrfopkcz, localhost, static build); both redeployed.
  docs.getblitz.io: PR jayokunle/getblitz#71 swaps the Pages workflow to publish the notice.
- 17:59 UTC step 6: getblitz-io-apps and Website STOPPED (exited), descriptions marked "delete on or after 2026-12-03". getblitz-postgres-apps + getblitz-redis-apps left running (retention). Shared servers/proxies/team variables untouched.
- 18:00 UTC public check: getblitz.io, www, app. (all page paths incl. /sign-in, /pay/*, /en/impressum) → 410 + notice; /api/*, /socket.io/* → 410 JSON service_discontinued; headers noindex + no-store, no cookies.
- Runner scheduled task deleted. Migration note: GetBlitz already runs on coolify-apps (the "rehearsal clone" app WAS production) — nothing left to migrate; remove GetBlitz from any migration plan kept outside Coolify.
