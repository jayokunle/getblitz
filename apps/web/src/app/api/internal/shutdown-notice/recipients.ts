import { createHash } from "node:crypto";

import type { NoticeGroup } from "./templates";

/** Operator's own orgs: never e-mailed, kept at shutdown (GATE 0 decision). */
export const OWNER_ORG_SLUGS = ["jayokunle", "test", "test4325"] as const;
/** Integrated merchants: get the detailed Group A notice (GATE 0 decision). */
export const GROUP_A_ORG_SLUGS = [
  "peptideplein247",
  "peptideplein-2-niew",
] as const;
/** Spam sign-ups: never e-mailed (GATE 0 decision). */
export const SPAM_ORG_SLUG_PREFIXES = ["httpswhopcomcheckoutplan-"] as const;

export interface UserWithOrgs {
  email: string;
  orgs: { slug: string; name: string }[];
}

export interface Recipient {
  email: string;
  /** Stable, non-reversible id for logs (never log the address itself). */
  ref: string;
  group: NoticeGroup;
  orgSlugs: string[];
  orgNames: string[];
}

export interface RecipientPlan {
  recipients: Recipient[];
  excludedOwner: number;
  excludedSpam: number;
}

export function recipientRef(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

const isOwnerOrg = (slug: string) =>
  (OWNER_ORG_SLUGS as readonly string[]).includes(slug);
const isGroupAOrg = (slug: string) =>
  (GROUP_A_ORG_SLUGS as readonly string[]).includes(slug);
const isSpamOrg = (slug: string) =>
  SPAM_ORG_SLUG_PREFIXES.some((p) => slug.startsWith(p));

/**
 * Splits users into Group A / Group B. A user in any owner org is excluded
 * entirely; a user whose only orgs are spam orgs is excluded; a user in any
 * Group A org gets Group A; everyone else (including users with no org) gets
 * Group B. Addresses are de-duplicated case-insensitively, Group A wins.
 */
export function planRecipients(users: UserWithOrgs[]): RecipientPlan {
  const byEmail = new Map<string, Recipient>();
  let excludedOwner = 0;
  let excludedSpam = 0;

  for (const user of users) {
    const email = user.email.trim();
    if (!email) continue;
    const key = email.toLowerCase();

    if (user.orgs.some((o) => isOwnerOrg(o.slug))) {
      excludedOwner++;
      continue;
    }
    const realOrgs = user.orgs.filter((o) => !isSpamOrg(o.slug));
    if (user.orgs.length > 0 && realOrgs.length === 0) {
      excludedSpam++;
      continue;
    }

    const aOrgs = realOrgs.filter((o) => isGroupAOrg(o.slug));
    const group: NoticeGroup = aOrgs.length > 0 ? "A" : "B";
    const orgs = group === "A" ? aOrgs : realOrgs;

    const existing = byEmail.get(key);
    if (existing && (existing.group === "A" || group === "B")) {
      // Merge org lists for the same address within the same group.
      if (existing.group === group) {
        for (const o of orgs) {
          if (!existing.orgSlugs.includes(o.slug)) {
            existing.orgSlugs.push(o.slug);
            existing.orgNames.push(o.name);
          }
        }
      }
      continue;
    }
    byEmail.set(key, {
      email,
      ref: recipientRef(email),
      group,
      orgSlugs: orgs.map((o) => o.slug),
      orgNames: orgs.map((o) => o.name),
    });
  }

  const recipients = [...byEmail.values()].sort((a, b) =>
    a.group === b.group ? a.ref.localeCompare(b.ref) : a.group === "A" ? -1 : 1,
  );
  return { recipients, excludedOwner, excludedSpam };
}
