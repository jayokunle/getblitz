import { describe, expect, it } from "vitest";

import { confirmToken, selectPurge } from "./plan";

describe("selectPurge", () => {
  const orgs = [
    { id: "o1", slug: "jayokunle", memberUserIds: ["u-owner"] },
    { id: "o2", slug: "test", memberUserIds: ["u-owner"] },
    { id: "o3", slug: "peptideplein247", memberUserIds: ["u-pep"] },
    { id: "o4", slug: "acme-inc", memberUserIds: ["u-acme", "u-owner"] },
  ];
  const users = ["u-owner", "u-pep", "u-acme", "u-orgless"];

  it("keeps only the listed orgs and their members", () => {
    const s = selectPurge(orgs, users, ["jayokunle", "test"]);
    expect(s.keepOrgIds).toEqual(["o1", "o2"]);
    expect(s.deleteOrgIds).toEqual(["o3", "o4"]);
    expect(s.deleteOrgSlugs).toEqual(["acme-inc", "peptideplein247"]);
    // a kept user is kept even if also a member of a deleted org
    expect(s.keepUserIds).toEqual(["u-owner"]);
    expect(s.deleteUserIds).toEqual(["u-pep", "u-acme", "u-orgless"]);
    expect(s.missingKeepSlugs).toEqual([]);
  });

  it("reports keep slugs that do not exist instead of guessing", () => {
    const s = selectPurge(orgs, users, ["jayokunle", "typo"]);
    expect(s.missingKeepSlugs).toEqual(["typo"]);
  });

  it("builds the confirmation token", () => {
    expect(confirmToken("purge", 27)).toBe("PURGE-27");
  });
});
