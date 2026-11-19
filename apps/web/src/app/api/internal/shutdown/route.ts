/**
 * POST /api/internal/shutdown — Stage 4 operations for the hosted-service
 * shutdown. Disabled (404) unless SHUTDOWN_NOTICE_SECRET is set; requires the
 * x-shutdown-secret header.
 *
 * Every mode is a DRY RUN unless the body has `execute: true` AND the exact
 * `confirm` token returned by the dry run (e.g. "PURGE-27").
 * Responses contain counts, org slugs and provider names only.
 *
 *  plan          overview of everything below (always read-only)
 *  revoke-banks  delete our webhook at the bank, revoke tokens, then wipe the
 *                stored credentials/config/webhook secret (rows are kept, so
 *                the kept org's bank_account → payment_session chain survives)
 *  delete-keys   delete all API keys and merchant webhooks (incl. secrets)
 *  purge         delete every org except keepOrgSlugs and every user who is
 *                not a member of a kept org, in one transaction
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { SecurityService } from "@getblitz/api/services";
import { prisma } from "@getblitz/database";

import { env } from "~/env";
import { OWNER_ORG_SLUGS } from "../shutdown-notice/recipients";
import { confirmToken, selectPurge } from "./plan";
import { revokeAtProvider } from "./revoke";

export const dynamic = "force-dynamic";

const MODES = ["plan", "revoke-banks", "delete-keys", "purge"] as const;
type Mode = (typeof MODES)[number];

interface Body {
  mode?: Mode;
  execute?: boolean;
  confirm?: string;
  keepOrgSlugs?: string[];
}

function authorized(req: Request): boolean {
  const secret = env.SHUTDOWN_NOTICE_SECRET;
  const given = req.headers.get("x-shutdown-secret") ?? "";
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function decryptJson(
  security: SecurityService,
  text: string | null,
): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(security.decrypt({ text })) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadSelection(keepOrgSlugs: readonly string[]) {
  const [orgs, users] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, slug: true, members: { select: { userId: true } } },
    }),
    prisma.user.findMany({ select: { id: true } }),
  ]);
  return selectPurge(
    orgs.map((o) => ({
      id: o.id,
      slug: o.slug,
      memberUserIds: o.members.map((m) => m.userId),
    })),
    users.map((u) => u.id),
    keepOrgSlugs,
  );
}

async function bankConnections(keepOrgIds: string[]) {
  const rows = await prisma.organizationBankConnection.findMany({
    select: {
      id: true,
      providerId: true,
      status: true,
      credentials: true,
      providerConfig: true,
      webhookUrl: true,
      webhookSecret: true,
      organization: { select: { id: true, slug: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    kept: keepOrgIds.includes(r.organization.id),
    hasSecrets: !!(r.credentials ?? r.providerConfig ?? r.webhookSecret),
  }));
}

async function purgeCounts(sel: ReturnType<typeof selectPurge>) {
  const org = { in: sel.deleteOrgIds };
  const user = { in: sel.deleteUserIds };
  const [
    transaction,
    invoice,
    customer,
    paymentSession,
    bankAccount,
    bankConnection,
    orgWebhook,
    apikey,
    invitation,
    member,
    organization,
    session,
    account,
    usr,
  ] = await Promise.all([
    prisma.transaction.count({
      where: { paymentSession: { organizationId: org } },
    }),
    prisma.invoice.count({ where: { organizationId: org } }),
    prisma.customer.count({ where: { organizationId: org } }),
    prisma.paymentSession.count({ where: { organizationId: org } }),
    prisma.bankAccount.count({
      where: { organizationBankConnection: { organizationId: org } },
    }),
    prisma.organizationBankConnection.count({
      where: { organizationId: org },
    }),
    prisma.organizationWebhook.count({ where: { organizationId: org } }),
    prisma.apikey.count({ where: { referenceId: org } }),
    prisma.invitation.count({
      where: { OR: [{ organizationId: org }, { inviterId: user }] },
    }),
    prisma.member.count({
      where: { OR: [{ organizationId: org }, { userId: user }] },
    }),
    prisma.organization.count({ where: { id: org } }),
    prisma.session.count({ where: { userId: user } }),
    prisma.account.count({ where: { userId: user } }),
    prisma.user.count({ where: { id: user } }),
  ]);
  return {
    transaction,
    invoice,
    customer,
    payment_session: paymentSession,
    bank_account: bankAccount,
    organization_bank_account: bankConnection,
    organization_webhook: orgWebhook,
    apikey,
    invitation,
    member,
    organization,
    session,
    account,
    user: usr,
  };
}

async function keptCounts(keepOrgIds: string[]) {
  const org = { in: keepOrgIds };
  const [sessions, paid, bankAccounts, transactions] = await Promise.all([
    prisma.paymentSession.count({ where: { organizationId: org } }),
    prisma.paymentSession.count({
      where: { organizationId: org, status: "PAID" },
    }),
    prisma.bankAccount.count({
      where: { organizationBankConnection: { organizationId: org } },
    }),
    prisma.transaction.count({
      where: { paymentSession: { organizationId: org } },
    }),
  ]);
  return {
    payment_session: sessions,
    payment_session_paid: paid,
    bank_account: bankAccounts,
    transaction: transactions,
  };
}

export async function POST(req: Request) {
  if (!env.SHUTDOWN_NOTICE_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const keepOrgSlugs = body.keepOrgSlugs?.length
    ? body.keepOrgSlugs
    : [...OWNER_ORG_SLUGS];
  const sel = await loadSelection(keepOrgSlugs);
  if (sel.missingKeepSlugs.length > 0) {
    return NextResponse.json(
      { error: "Unknown keepOrgSlugs", missing: sel.missingKeepSlugs },
      { status: 400 },
    );
  }

  const mode: Mode = body.mode ?? "plan";
  if (!(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }
  const wantsExecute = body.execute === true;

  if (mode === "plan") {
    const conns = await bankConnections(sel.keepOrgIds);
    const now = new Date();
    const inFlight = await prisma.paymentSession.findMany({
      where: {
        status: { in: ["PENDING", "PARTIAL"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { organization: { select: { slug: true } } },
    });
    return NextResponse.json({
      keepOrgSlugs,
      keptUsers: sel.keepUserIds.length,
      kept: await keptCounts(sel.keepOrgIds),
      blockNewPaymentSessions: env.BLOCK_NEW_PAYMENT_SESSIONS,
      inFlightSessions: inFlight.map((s) => s.organization.slug),
      bankConnectionsWithSecrets: conns
        .filter((c) => c.hasSecrets)
        .map((c) => ({
          org: c.organization.slug,
          provider: c.providerId,
          status: c.status,
          hasCredentials: !!c.credentials,
          hasWebhook: !!c.webhookUrl,
          kept: c.kept,
        })),
      apiKeys: await prisma.apikey.count(),
      merchantWebhooks: await prisma.organizationWebhook.count(),
      purge: {
        deleteOrgSlugs: sel.deleteOrgSlugs,
        rows: await purgeCounts(sel),
      },
      confirmTokens: {
        "revoke-banks": confirmToken(
          "revoke-banks",
          conns.filter((c) => c.hasSecrets).length,
        ),
        "delete-keys": confirmToken(
          "delete-keys",
          (await prisma.apikey.count()) +
            (await prisma.organizationWebhook.count()),
        ),
        purge: confirmToken("purge", sel.deleteOrgIds.length),
      },
    });
  }

  if (mode === "revoke-banks") {
    const conns = (await bankConnections(sel.keepOrgIds)).filter(
      (c) => c.hasSecrets,
    );
    const token = confirmToken(mode, conns.length);
    if (!wantsExecute || body.confirm !== token) {
      return NextResponse.json({
        dryRun: true,
        confirm: token,
        wouldRevoke: conns.map((c) => ({
          org: c.organization.slug,
          provider: c.providerId,
          status: c.status,
          hasCredentials: !!c.credentials,
          hasWebhook: !!c.webhookUrl,
          rowKept: true,
        })),
      });
    }
    const security = new SecurityService();
    const results = [];
    for (const c of conns) {
      const result = await revokeAtProvider({
        providerId: c.providerId,
        webhookUrl: c.webhookUrl,
        config: decryptJson(security, c.providerConfig),
        credentials: decryptJson(security, c.credentials),
      });
      // Wipe secrets but keep the row: deleting it would cascade into
      // bank_account and payment_session of the kept org.
      await prisma.organizationBankConnection.update({
        where: { id: c.id },
        data: {
          credentials: null,
          providerConfig: null,
          webhookSecret: null,
          status: "DISCONNECTED",
        },
      });
      results.push({
        org: c.organization.slug,
        provider: c.providerId,
        ...result,
        storedSecretsWiped: true,
      });
    }
    return NextResponse.json({ executed: true, results });
  }

  if (mode === "delete-keys") {
    const [apiKeys, webhooks] = await Promise.all([
      prisma.apikey.count(),
      prisma.organizationWebhook.count(),
    ]);
    const token = confirmToken(mode, apiKeys + webhooks);
    if (!wantsExecute || body.confirm !== token) {
      return NextResponse.json({
        dryRun: true,
        confirm: token,
        apiKeys,
        webhooks,
      });
    }
    const [k, w] = await prisma.$transaction([
      prisma.apikey.deleteMany({}),
      prisma.organizationWebhook.deleteMany({}),
    ]);
    return NextResponse.json({
      executed: true,
      deleted: { apikey: k.count, organization_webhook: w.count },
    });
  }

  // mode === "purge"
  const token = confirmToken(mode, sel.deleteOrgIds.length);
  const before = await purgeCounts(sel);
  if (!wantsExecute || body.confirm !== token) {
    return NextResponse.json({
      dryRun: true,
      confirm: token,
      deleteOrgSlugs: sel.deleteOrgSlugs,
      keptUsers: sel.keepUserIds.length,
      wouldDelete: before,
    });
  }
  const keptBefore = await keptCounts(sel.keepOrgIds);
  const org = { in: sel.deleteOrgIds };
  const user = { in: sel.deleteUserIds };
  const deleted = await prisma.$transaction(
    async (tx) => {
      const d: Record<string, number> = {};
      d.transaction = (
        await tx.transaction.deleteMany({
          where: { paymentSession: { organizationId: org } },
        })
      ).count;
      d.invoice = (
        await tx.invoice.deleteMany({ where: { organizationId: org } })
      ).count;
      d.customer = (
        await tx.customer.deleteMany({ where: { organizationId: org } })
      ).count;
      d.payment_session = (
        await tx.paymentSession.deleteMany({ where: { organizationId: org } })
      ).count;
      d.bank_account = (
        await tx.bankAccount.deleteMany({
          where: { organizationBankConnection: { organizationId: org } },
        })
      ).count;
      d.organization_bank_account = (
        await tx.organizationBankConnection.deleteMany({
          where: { organizationId: org },
        })
      ).count;
      d.organization_webhook = (
        await tx.organizationWebhook.deleteMany({
          where: { organizationId: org },
        })
      ).count;
      d.apikey = (
        await tx.apikey.deleteMany({ where: { referenceId: org } })
      ).count;
      d.invitation = (
        await tx.invitation.deleteMany({
          where: { OR: [{ organizationId: org }, { inviterId: user }] },
        })
      ).count;
      d.member = (
        await tx.member.deleteMany({
          where: { OR: [{ organizationId: org }, { userId: user }] },
        })
      ).count;
      d.organization = (
        await tx.organization.deleteMany({ where: { id: org } })
      ).count;
      d.session = (
        await tx.session.deleteMany({ where: { userId: user } })
      ).count;
      d.account = (
        await tx.account.deleteMany({ where: { userId: user } })
      ).count;
      d.user = (await tx.user.deleteMany({ where: { id: user } })).count;
      d.verification = (await tx.verification.deleteMany({})).count;
      return d;
    },
    { timeout: 120_000 },
  );
  const keptAfter = await keptCounts(sel.keepOrgIds);
  return NextResponse.json({
    executed: true,
    deleted,
    keptBefore,
    keptAfter,
    keptUnchanged: JSON.stringify(keptBefore) === JSON.stringify(keptAfter),
  });
}
