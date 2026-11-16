-- GetBlitz shutdown — Stage 0 recon, DBeaver version. READ-ONLY (single SELECT, no writes).
-- Output: one grid (section, ord, detail). Counts, org slugs/names, provider names only.
-- No emails, tokens, IBANs or secrets.
-- In DBeaver: run ROLLBACK; once first if it says "transaction in progress",
-- then put the cursor in this query and press Ctrl+Enter. Copy the grid with Ctrl+A, Ctrl+C.

WITH
org_stats AS (
  SELECT o.id, o.slug, o.name, o."createdAt"::date AS created,
         (SELECT count(*) FROM member m WHERE m."organizationId" = o.id)                    AS users,
         (SELECT count(*) FROM payment_session p WHERE p."organizationId" = o.id)           AS sessions,
         (SELECT count(*) FROM organization_bank_account c WHERE c."organizationId" = o.id) AS bank_conns,
         (SELECT count(*) FROM apikey k WHERE k."referenceId" = o.id)                       AS api_keys,
         (SELECT count(*) FROM organization_webhook w WHERE w."organizationId" = o.id)      AS webhooks,
         (o.name ~* '(https?://|www\.|\.[a-z]{2,6}(/|$))' OR o.slug ~* '(http|www)')        AS looks_like_url
  FROM organization o
),
q0 AS (
  SELECT 'Q0 totals' AS section, 0 AS ord, format(
    'users=%s orgs=%s memberships=%s users_without_org=%s payment_sessions=%s bank_connections=%s bank_accounts=%s api_keys=%s merchant_webhooks=%s invoices=%s customers=%s transactions=%s',
    (SELECT count(*) FROM "user"),
    (SELECT count(*) FROM organization),
    (SELECT count(*) FROM member),
    (SELECT count(*) FROM "user" u WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id)),
    (SELECT count(*) FROM payment_session),
    (SELECT count(*) FROM organization_bank_account),
    (SELECT count(*) FROM bank_account),
    (SELECT count(*) FROM apikey),
    (SELECT count(*) FROM organization_webhook),
    (SELECT count(*) FROM invoice),
    (SELECT count(*) FROM customer),
    (SELECT count(*) FROM "transaction")) AS detail
),
q1 AS (
  SELECT 'Q1 orgs with sessions' AS section,
         row_number() OVER (ORDER BY count(*) DESC)::int AS ord,
         format('%s | %s | sessions=%s paid=%s partial=%s pending=%s failed=%s expired=%s paid_cents=%s last=%s',
           o.slug, o.name, count(*),
           count(*) FILTER (WHERE ps.status = 'PAID'),
           count(*) FILTER (WHERE ps.status = 'PARTIAL'),
           count(*) FILTER (WHERE ps.status = 'PENDING'),
           count(*) FILTER (WHERE ps.status = 'FAILED'),
           count(*) FILTER (WHERE ps.status = 'EXPIRED'),
           coalesce(sum(ps."amountPaidCents"), 0),
           max(ps."createdAt")::date) AS detail
  FROM organization o JOIN payment_session ps ON ps."organizationId" = o.id
  GROUP BY o.slug, o.name
),
q2 AS (
  SELECT 'Q2 bank connections' AS section,
         row_number() OVER (ORDER BY (o.slug = 'jayokunle') DESC, o.slug)::int AS ord,
         format('%s | provider=%s status=%s sandbox=%s has_credentials=%s has_config=%s has_bank_webhook=%s bank_accounts=%s created=%s',
           o.slug, c."providerId", c.status, c."isSandbox",
           (c.credentials IS NOT NULL), (c."providerConfig" IS NOT NULL), (c."webhookUrl" IS NOT NULL),
           (SELECT count(*) FROM bank_account b WHERE b."organizationBankConnectionId" = c.id),
           c."createdAt"::date) AS detail
  FROM organization_bank_account c JOIN organization o ON o.id = c."organizationId"
),
q3 AS (
  SELECT 'Q3 orgs' AS section,
         row_number() OVER (ORDER BY sessions DESC, bank_conns DESC, created)::int AS ord,
         format('%s | %s | created=%s users=%s sessions=%s bank_conns=%s api_keys=%s webhooks=%s url_like_name=%s',
           slug, name, created, users, sessions, bank_conns, api_keys, webhooks, looks_like_url) AS detail
  FROM org_stats
),
q4 AS (
  SELECT 'Q4 locale hint (email TLD)' AS section, 0 AS ord,
         format('de/at/ch=%s other=%s',
           count(*) FILTER (WHERE email ~* '\.(de|at|ch)$'),
           count(*) FILTER (WHERE email !~* '\.(de|at|ch)$')) AS detail
  FROM "user"
),
q5 AS (
  SELECT 'Q5 auth providers' AS section, 0 AS ord,
         coalesce(string_agg(format('%s=%s', "providerId", n), ' '), 'none') AS detail
  FROM (SELECT "providerId", count(*) AS n FROM account GROUP BY 1) a
)
SELECT section, ord, detail FROM (
  SELECT * FROM q0 UNION ALL SELECT * FROM q1 UNION ALL SELECT * FROM q2
  UNION ALL SELECT * FROM q3 UNION ALL SELECT * FROM q4 UNION ALL SELECT * FROM q5
) x
ORDER BY CASE section WHEN 'Q0 totals' THEN 0 WHEN 'Q1 orgs with sessions' THEN 1
                      WHEN 'Q2 bank connections' THEN 2 WHEN 'Q3 orgs' THEN 3
                      WHEN 'Q4 locale hint (email TLD)' THEN 4 ELSE 5 END, ord;
