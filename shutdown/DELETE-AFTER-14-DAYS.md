# GetBlitz — deletion checklist

> **Status 2026-11-19:** sections 1–2 were done early at the operator's request
> (app, Website, Redis and Postgres deleted; see LOG.md). Remaining: sections 3–4
> and deciding how long to keep the S3 backup copies of the `production` DB.


Everything below is in the Coolify project **GetBlitz** only. Do **not** touch the
servers (`coolify-apps`, `localhost`, `coolify-builder`), their proxies, the team
shared variables (SMTP_* are shared with Sprachflow/Semantik) or other projects.

## 1. Before deleting anything
- [ ] Steuerberater has confirmed the retention period for the `jayokunle` payment
      records (27 payment sessions, 8 PAID, 8 transactions in DB `production`).
- [ ] The encrypted backup from `shutdown/backup.sh` (operator's machine,
      `~/getblitz-shutdown-backup/…dump.gpg`) restores — re-run
      `shutdown/backup.sh --verify <file>` once — and the passphrase is stored safely.
- [ ] No open merchant/customer requests in hello@jayokunle.com (exports, missing payments).

## 2. Delete in Coolify (Project GetBlitz → resource → Danger zone → Delete,
##    tick "delete volumes" and "delete configurations")
| Resource | UUID | Notes |
|---|---|---|
| `getblitz-io-apps` (stopped) | hy5ifixzasfpycsiggyptajs | removes its env vars (incl. secrets) too |
| `Website` (stopped) | rjdcllp6unds5vcaz66ci9v9 | |
| `getblitz-redis-apps` | bvdwvlttxc0rvt3eartno5ie | GetBlitz-only Redis; stop first, then delete |
| `getblitz-postgres-apps` | pjieqqosqag6oavjx70ztuux | **only after step 1**; its backup schedule goes with it — decide separately whether to keep the S3 copies until the retention period ends |

## 3. Keep while the domains are kept
| Resource | UUID | Serves |
|---|---|---|
| `getblitz-shutdown-notice-app` | 30pk0mvzdchbrzni2euhepa7 | app.getblitz.io |
| `getblitz-shutdown-notice-website` | z8c8hnfaynca1qdmgrfopkcz | getblitz.io, www |
If you let getblitz.io lapse: delete both, then the (empty) GetBlitz project.

## 4. Outside Coolify (manual)
- GitHub Packages: delete `ghcr.io/jayokunle/getblitz-io` images.
- Qonto: revoke the GetBlitz app connection and delete its webhook (own account).
- Mailjet: rotate the API key that was exposed in the agent transcript, update the team variable.
- Domain getblitz.io: renewal decision (keep ≥ 12 months to avoid domain takeover of old widget/API URLs is recommended).
