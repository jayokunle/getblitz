-- GetBlitz shutdown — Stage 0 recon. READ-ONLY. psql ONLY (uses \echo). For DBeaver use stage0_recon_dbeaver.sql.
-- Output: counts, org names/slugs, provider names. No emails, tokens, IBANs or secrets.
-- Run in Coolify: Databases → getblitz-postgres-apps → Terminal:
--   psql -U postgres -l                       # find the GetBlitz DB name (likely "postgres" or "getblitz")
--   psql -U postgres -d <db> -f - <<'SQL' ... SQL   (or paste the statements below)

BEGIN TRANSACTION READ ONLY;

\echo '== Q0 totals'
SELECT (SELECT count(*) FROM "user")          AS users,
       (SELECT count(*) FROM organization)    AS orgs,
       (SELECT count(*) FROM member)          AS memberships,
       (SELECT count(*) FROM "user" u WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id)) AS users_without_org,
       (SELECT count(*) FROM payment_session) AS payment_sessions,
       (SELECT count(*) FROM organization_bank_account) AS bank_connections,
       (SELECT count(*) FROM bank_account)    AS bank_accounts,
       (SELECT count(*) FROM apikey)          AS api_keys,
       (SELECT count(*) FROM organization_webhook) AS merchant_webhooks,
       (SELECT count(*) FROM invoice)         AS invoices,
       (SELECT count(*) FROM customer)        AS customers,
       (SELECT count(*) FROM "transaction")   AS transactions;

\echo '== Q1 orgs with >=1 payment_session (any status)'
SELECT o.slug, o.name,
       count(ps.*)                                         AS sessions,
       count(*) FILTER (WHERE ps.status = 'PAID')          AS paid,
       count(*) FILTER (WHERE ps.status = 'PARTIAL')       AS partial,
       count(*) FILTER (WHERE ps.status = 'PENDING')       AS pending,
       count(*) FILTER (WHERE ps.status = 'FAILED')        AS failed,
       count(*) FILTER (WHERE ps.status = 'EXPIRED')       AS expired,
       coalesce(sum(ps."amountPaidCents"), 0)              AS amount_paid_cents,
       max(ps."createdAt")::date                           AS last_session
FROM organization o JOIN payment_session ps ON ps."organizationId" = o.id
GROUP BY o.slug, o.name ORDER BY sessions DESC;

\echo '== Q2 bank connections per org (STOP condition: any non-jayokunle row with status CONNECTED/NEEDS_REAUTH or credentials present)'
SELECT o.slug, c."providerId", c.status, c."isSandbox",
       (c.credentials IS NOT NULL)      AS has_credentials,
       (c."providerConfig" IS NOT NULL) AS has_config,
       (c."webhookUrl" IS NOT NULL)     AS has_bank_webhook,
       (SELECT count(*) FROM bank_account b WHERE b."organizationBankConnectionId" = c.id) AS bank_accounts,
       c."createdAt"::date
FROM organization_bank_account c JOIN organization o ON o.id = c."organizationId"
ORDER BY (o.slug = 'jayokunle') DESC, o.slug;

\echo '== Q3 users per org + activity + junk heuristics'
SELECT o.slug, o.name, o."createdAt"::date AS created,
       (SELECT count(*) FROM member m WHERE m."organizationId" = o.id)                  AS users,
       (SELECT count(*) FROM payment_session p WHERE p."organizationId" = o.id)         AS sessions,
       (SELECT count(*) FROM organization_bank_account c WHERE c."organizationId" = o.id) AS bank_conns,
       (SELECT count(*) FROM apikey k WHERE k."referenceId" = o.id)                     AS api_keys,
       (SELECT count(*) FROM organization_webhook w WHERE w."organizationId" = o.id)    AS webhooks,
       (o.name ~* '(https?://|www\.|\.[a-z]{2,6}(/|$))' OR o.slug ~* '(http|www)')      AS name_looks_like_url
FROM organization o ORDER BY sessions DESC, bank_conns DESC, o."createdAt";

\echo '== Q4 locale hint (counts only, by email TLD)'
SELECT CASE WHEN email ~* '\.(de|at|ch)$' THEN 'de/at/ch' ELSE 'other' END AS tld_group, count(*)
FROM "user" GROUP BY 1;

\echo '== Q5 auth method per user (counts only)'
SELECT "providerId", count(*) FROM account GROUP BY 1;

ROLLBACK;
