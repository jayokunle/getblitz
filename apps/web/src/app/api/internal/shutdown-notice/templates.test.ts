import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { renderGroupA, renderGroupB } from "./templates";

// The reviewed drafts live in <repo>/shutdown/emails; keep them identical.
const draft = (name: string) =>
  readFileSync(
    resolve(__dirname, "../../../../../../../shutdown/emails", name),
    "utf8",
  );
const asDraft = (n: { subject: string; text: string }) =>
  `Subject: ${n.subject}\n\n${n.text}`;

describe("shutdown notice templates", () => {
  it("Group A matches the reviewed draft", () => {
    expect(asDraft(renderGroupA("{{ORG_NAME}}"))).toBe(draft("group-a.txt"));
  });
  it("Group B matches the reviewed draft", () => {
    expect(asDraft(renderGroupB())).toBe(draft("group-b.txt"));
  });
  it("does not mention licences or regulators", () => {
    for (const n of [renderGroupA("X"), renderGroupB()]) {
      expect(n.text).not.toMatch(/bafin|licen[cs]e(?!d)|regulat/i);
    }
  });
});
