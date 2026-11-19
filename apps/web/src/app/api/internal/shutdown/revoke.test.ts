import { describe, expect, it } from "vitest";

import { revokeAtProvider } from "./revoke";

interface Call {
  url: string;
  method: string;
}

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const f = ((url: string | URL | Request, init?: RequestInit) => {
    const u =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    calls.push({ url: u, method });
    const r = routes[`${method} ${u}`] ?? { status: 404 };
    return Promise.resolve(
      new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status,
      }),
    );
  }) as typeof fetch;
  return { f, calls };
}

const HOOK = "https://app.getblitz.io/api/webhooks/connection/c1";

describe("revokeAtProvider – qonto", () => {
  const base = {
    providerId: "qonto",
    webhookUrl: HOOK,
    config: { clientId: "cid", clientSecret: "csec", sandboxMode: false },
    credentials: { accessToken: "old", refreshToken: "rt" },
  };

  it("refreshes, deletes only our webhook and revokes the grant", async () => {
    const { f, calls } = fakeFetch({
      "POST https://oauth.qonto.com/oauth2/token": {
        status: 200,
        body: { access_token: "new" },
      },
      "GET https://thirdparty.qonto.com/v2/webhook_subscriptions": {
        status: 200,
        body: {
          webhook_subscriptions: [
            { id: "w1", callback_url: HOOK },
            { id: "w2", callback_url: "https://other.example/hook" },
          ],
        },
      },
      "DELETE https://thirdparty.qonto.com/v2/webhook_subscriptions/w1": {
        status: 204,
      },
      "POST https://oauth.qonto.com/oauth2/revoke": { status: 200 },
    });
    const r = await revokeAtProvider(base, f);
    expect(r).toMatchObject({ webhook: "deleted", token: "revoked" });
    expect(r.manualAction).toBeUndefined();
    expect(calls.some((c) => c.url.endsWith("/w2"))).toBe(false);
  });

  it("reports a manual action when the grant is dead", async () => {
    const { f } = fakeFetch({
      "POST https://oauth.qonto.com/oauth2/token": { status: 400 },
      "GET https://thirdparty.qonto.com/v2/webhook_subscriptions": {
        status: 401,
      },
      "POST https://oauth.qonto.com/oauth2/revoke": { status: 400 },
    });
    const r = await revokeAtProvider(base, f);
    expect(r.webhook).toBe("failed");
    expect(r.token).toBe("failed");
    expect(r.manualAction).toMatch(/Qonto/);
  });
});

describe("revokeAtProvider – wise", () => {
  it("deletes our subscription; token always needs manual revocation", async () => {
    const { f } = fakeFetch({
      "GET https://api.wise.com/v3/profiles/p1/subscriptions": {
        status: 200,
        body: [
          { id: "s1", delivery: { url: HOOK } },
          { id: "s2", delivery: { url: "https://x" } },
        ],
      },
      "DELETE https://api.wise.com/v3/profiles/p1/subscriptions/s1": {
        status: 204,
      },
    });
    const r = await revokeAtProvider(
      {
        providerId: "wise",
        webhookUrl: HOOK,
        config: { apiToken: "t", profileId: "p1", sandboxMode: false },
        credentials: { apiToken: "t", profileId: "p1" },
      },
      f,
    );
    expect(r.webhook).toBe("deleted");
    expect(r.token).toBe("manual");
    expect(r.manualAction).toMatch(/Wise/);
  });
});

describe("revokeAtProvider – nothing stored", () => {
  it("makes no network calls", async () => {
    const { f, calls } = fakeFetch({});
    const r = await revokeAtProvider(
      {
        providerId: "revolut",
        webhookUrl: null,
        config: null,
        credentials: null,
      },
      f,
    );
    expect(r).toMatchObject({ webhook: "none-stored", token: "none-stored" });
    expect(calls).toHaveLength(0);
  });
});
