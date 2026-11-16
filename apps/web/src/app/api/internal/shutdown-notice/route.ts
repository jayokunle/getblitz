/**
 * POST /api/internal/shutdown-notice
 *
 * One-off mailer for the hosted-service shutdown notice. Disabled (404)
 * unless SHUTDOWN_NOTICE_SECRET is set. Responses and logs never contain
 * e-mail addresses: recipients are identified by a short hash (`ref`) and
 * their org slugs.
 *
 * Body: { "mode": "dry-run" | "test" | "send" | "report", "expectedRecipients"?: number }
 *  - dry-run: who would receive which notice (counts + org slugs).
 *  - test:    sends both notices to the owner of the operator's org only.
 *  - send:    sends to everyone not yet sent; requires expectedRecipients to
 *             match the dry-run total. Runs in the background, rate-limited,
 *             retries failures once. Idempotent via Redis markers.
 *  - report:  per-recipient status of the send run.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { prisma } from "@getblitz/database";
import { getRedisClient } from "@getblitz/redis";

import type { Recipient } from "./recipients";
import type { NoticeGroup, RenderedNotice } from "./templates";
import { env } from "~/env";
import { OWNER_ORG_SLUGS, planRecipients } from "./recipients";
import { renderGroupA, renderGroupB } from "./templates";

export const dynamic = "force-dynamic";

const CAMPAIGN = "shutdown-notice:v1";
const SENT_KEY = (ref: string) => `${CAMPAIGN}:sent:${ref}`;
const LOG_KEY = `${CAMPAIGN}:log`;
const LOCK_KEY = `${CAMPAIGN}:lock`;
const SEND_INTERVAL_MS = 1500;
const RETRY_DELAY_MS = 15_000;

type Mode = "dry-run" | "test" | "send" | "report";

function authorized(req: Request): boolean {
  const secret = env.SHUTDOWN_NOTICE_SECRET;
  const given = req.headers.get("x-shutdown-secret") ?? "";
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function render(r: Pick<Recipient, "group" | "orgNames">): RenderedNotice {
  return r.group === "A" ? renderGroupA(r.orgNames.join(", ")) : renderGroupB();
}

function mailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    throw new Error("SMTP is not configured");
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return {
    verify: () => transport.verify(),
    send: (to: string, notice: RenderedNotice) =>
      transport.sendMail({
        from: `GetBlitz <${SMTP_FROM}>`,
        to,
        replyTo: env.SMTP_REPLY_TO,
        subject: notice.subject,
        text: notice.text,
        headers: { "X-GetBlitz-Campaign": CAMPAIGN },
      }),
  };
}

async function loadPlan() {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      members: {
        select: { organization: { select: { slug: true, name: true } } },
      },
    },
  });
  return planRecipients(
    users.map((u) => ({
      email: u.email,
      orgs: u.members.map((m) => m.organization),
    })),
  );
}

function summarize(recipients: Recipient[], group: NoticeGroup) {
  const list = recipients.filter((r) => r.group === group);
  return {
    recipients: list.length,
    orgs: [...new Set(list.flatMap((r) => r.orgSlugs))].sort(),
  };
}

async function logResult(
  r: Recipient,
  status: "sent" | "failed",
  error?: string,
) {
  const previous = await getRedisClient().hget(LOG_KEY, r.ref);
  const prev = previous
    ? (JSON.parse(previous) as { attempts?: number; error?: string })
    : undefined;
  const entry = {
    attempts: (prev?.attempts ?? 0) + 1,
    previousError: status === "sent" ? prev?.error : undefined,
    group: r.group,
    orgs: r.orgSlugs,
    status,
    error: error?.slice(0, 200),
    at: new Date().toISOString(),
  };
  await getRedisClient().hset(LOG_KEY, r.ref, JSON.stringify(entry));
  console.log(`[${CAMPAIGN}] ${r.ref} group=${r.group} ${status}`, error ?? "");
}

function errorText(e: unknown): string {
  const err = e as { responseCode?: number; code?: string; message?: string };
  // Strip anything that looks like an address from provider error messages.
  const msg = (err.message ?? String(e)).replace(/\S+@\S+/g, "<address>");
  return [err.responseCode, err.code, msg].filter(Boolean).join(" ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSend(recipients: Recipient[]) {
  const redis = getRedisClient();
  const mail = mailer();
  const failed: Recipient[] = [];
  try {
    for (const pass of [1, 2] as const) {
      const queue = pass === 1 ? recipients : failed.splice(0);
      if (pass === 2 && queue.length > 0) await sleep(RETRY_DELAY_MS);
      for (const r of queue) {
        if (await redis.exists(SENT_KEY(r.ref))) continue;
        try {
          await mail.send(r.email, render(r));
          await redis.set(SENT_KEY(r.ref), new Date().toISOString());
          await logResult(r, "sent");
        } catch (e) {
          await logResult(r, "failed", `pass ${pass}: ${errorText(e)}`);
          if (pass === 1) failed.push(r);
        }
        await sleep(SEND_INTERVAL_MS);
      }
    }
  } finally {
    await redis.del(LOCK_KEY);
    console.log(`[${CAMPAIGN}] run finished`);
  }
}

export async function POST(req: Request) {
  if (!env.SHUTDOWN_NOTICE_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: Mode;
    expectedRecipients?: number;
  };
  const redis = getRedisClient();

  if (body.mode === "report") {
    const log = await redis.hgetall(LOG_KEY);
    const entries = Object.entries(log).map(([ref, v]) => ({
      ref,
      ...(JSON.parse(v) as { status: "sent" | "failed" } & Record<
        string,
        unknown
      >),
    }));
    return NextResponse.json({
      running: (await redis.exists(LOCK_KEY)) === 1,
      sent: entries.filter((e) => e.status === "sent").length,
      failed: entries.filter((e) => e.status === "failed").length,
      entries,
    });
  }

  const plan = await loadPlan();

  if (body.mode === "dry-run") {
    let alreadySent = 0;
    for (const r of plan.recipients) {
      if (await redis.exists(SENT_KEY(r.ref))) alreadySent++;
    }
    return NextResponse.json({
      total: plan.recipients.length,
      groupA: summarize(plan.recipients, "A"),
      groupB: summarize(plan.recipients, "B"),
      excludedOwnerUsers: plan.excludedOwner,
      excludedSpamUsers: plan.excludedSpam,
      alreadySent,
      from: env.SMTP_FROM ?? null,
      replyTo: env.SMTP_REPLY_TO ?? null,
    });
  }

  if (body.mode === "test") {
    const owner = await prisma.member.findFirst({
      where: { organization: { slug: OWNER_ORG_SLUGS[0] }, role: "owner" },
      select: { user: { select: { email: true } } },
    });
    if (!owner) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }
    const mail = mailer();
    await mail.verify();
    const results = [];
    for (const group of ["A", "B"] as const) {
      const notice = render({
        group,
        orgNames: ["peptideplein247 (TEST)"],
      });
      try {
        const info = await mail.send(owner.user.email, {
          ...notice,
          subject: `[TEST ${group}] ${notice.subject}`,
        });
        results.push({ group, status: "sent", messageId: info.messageId });
      } catch (e) {
        results.push({ group, status: "failed", error: errorText(e) });
      }
    }
    return NextResponse.json({ to: "owner of jayokunle", results });
  }

  if (body.mode === "send") {
    if (body.expectedRecipients !== plan.recipients.length) {
      return NextResponse.json(
        {
          error: "expectedRecipients does not match the current plan",
          total: plan.recipients.length,
        },
        { status: 409 },
      );
    }
    const locked = await redis.set(LOCK_KEY, "1", "EX", 1800, "NX");
    if (!locked) {
      return NextResponse.json({ error: "Already running" }, { status: 409 });
    }
    try {
      await mailer().verify();
    } catch (e) {
      await redis.del(LOCK_KEY);
      return NextResponse.json(
        { error: `SMTP check failed: ${errorText(e)}` },
        { status: 502 },
      );
    }
    void runSend(plan.recipients);
    return NextResponse.json(
      { started: true, total: plan.recipients.length },
      { status: 202 },
    );
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
