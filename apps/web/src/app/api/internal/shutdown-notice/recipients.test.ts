import { describe, expect, it } from "vitest";

import { planRecipients, recipientRef } from "./recipients";

const org = (slug: string) => ({ slug, name: slug.toUpperCase() });

describe("planRecipients", () => {
  const plan = planRecipients([
    { email: "owner@x.test", orgs: [org("jayokunle")] },
    { email: "owner2@x.test", orgs: [org("test4325")] },
    { email: "merchant@x.test", orgs: [org("peptideplein247")] },
    { email: "Merchant@X.test", orgs: [org("peptideplein-2-niew")] },
    { email: "spam@x.test", orgs: [org("httpswhopcomcheckoutplan-abc")] },
    { email: "b1@x.test", orgs: [org("acme-inc")] },
    { email: "orgless@x.test", orgs: [] },
    { email: "mixed@x.test", orgs: [org("bale"), org("peptideplein247")] },
  ]);

  it("excludes the operator's own and spam accounts", () => {
    expect(plan.excludedOwner).toBe(2);
    expect(plan.excludedSpam).toBe(1);
    const emails = plan.recipients.map((r) => r.email.toLowerCase());
    expect(emails).not.toContain("owner@x.test");
    expect(emails).not.toContain("spam@x.test");
  });

  it("puts Group A merchants first, de-duplicated with merged orgs", () => {
    const a = plan.recipients.filter((r) => r.group === "A");
    expect(a).toHaveLength(2);
    const merchant = a.find((r) => r.email.toLowerCase() === "merchant@x.test");
    expect(merchant?.orgSlugs).toEqual([
      "peptideplein247",
      "peptideplein-2-niew",
    ]);
    expect(a.find((r) => r.email === "mixed@x.test")?.orgSlugs).toEqual([
      "peptideplein247",
    ]);
    expect(plan.recipients[0]?.group).toBe("A");
  });

  it("sends Group B to other users, including users without an org", () => {
    const b = plan.recipients
      .filter((r) => r.group === "B")
      .map((r) => r.email);
    expect(b.sort()).toEqual(["b1@x.test", "orgless@x.test"]);
  });

  it("uses a stable, case-insensitive ref that is not the address", () => {
    expect(recipientRef("A@B.test")).toBe(recipientRef(" a@b.test "));
    expect(recipientRef("a@b.test")).toMatch(/^[0-9a-f]{12}$/);
  });
});
