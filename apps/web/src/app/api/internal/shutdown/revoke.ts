/**
 * Revoke GetBlitz's access at the bank before stored credentials are wiped.
 *
 * GetBlitz never stored the bank-side webhook subscription id, so we list the
 * subscriptions and delete the one(s) whose URL equals the stored webhookUrl.
 * Every step is best-effort and reported; nothing here throws.
 */
import { createHmac } from "node:crypto";

type Fetch = typeof fetch;

export interface RevokeInput {
  providerId: string;
  webhookUrl: string | null;
  config: Record<string, unknown> | null;
  credentials: Record<string, unknown> | null;
}

export interface RevokeResult {
  webhook: "deleted" | "not-found" | "none-stored" | "failed" | "unsupported";
  token: "revoked" | "failed" | "manual" | "none-stored" | "unsupported";
  manualAction?: string;
  errors: string[];
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const short = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 160);

async function qonto(input: RevokeInput, f: Fetch): Promise<RevokeResult> {
  const r: RevokeResult = {
    webhook: "none-stored",
    token: "none-stored",
    errors: [],
  };
  const clientId = str(input.config?.clientId);
  const clientSecret = str(input.config?.clientSecret);
  const sandbox = input.config?.sandboxMode === true;
  const stagingToken = str(input.config?.sandboxToken);
  const oauth = sandbox
    ? "https://oauth-sandbox.staging.qonto.co"
    : "https://oauth.qonto.com";
  const api = sandbox
    ? "https://thirdparty-sandbox.staging.qonto.co"
    : "https://thirdparty.qonto.com";
  const testing: Record<string, string> =
    sandbox && stagingToken ? { "X-Qonto-Staging-Token": stagingToken } : {};
  const sign = (body = ""): Record<string, string> => {
    if (!clientSecret) return {};
    const t = Math.floor(Date.now() / 1000).toString();
    const v1 = createHmac("sha256", clientSecret)
      .update(`${t}.${body}`)
      .digest("hex");
    return { "X-Qonto-Signature": `t=${t},v1=${v1}` };
  };

  let accessToken = str(input.credentials?.accessToken);
  const refreshToken = str(input.credentials?.refreshToken);

  // A NEEDS_REAUTH connection usually has an expired access token: try one refresh.
  if (refreshToken && clientId && clientSecret) {
    try {
      const res = await f(`${oauth}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...testing,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { access_token?: string };
        accessToken = data.access_token ?? accessToken;
      } else {
        r.errors.push(`token refresh ${res.status}`);
      }
    } catch (e) {
      r.errors.push(`token refresh: ${short(e)}`);
    }
  }

  if (input.webhookUrl) {
    if (!accessToken) {
      r.webhook = "failed";
      r.errors.push("no access token for webhook lookup");
    } else {
      try {
        const res = await f(`${api}/v2/webhook_subscriptions`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...testing,
            ...sign(),
          },
        });
        if (!res.ok) throw new Error(`list ${res.status}`);
        const body = (await res.json()) as unknown;
        const list = (
          Array.isArray(body)
            ? body
            : ((body as { webhook_subscriptions?: unknown[] })
                .webhook_subscriptions ?? [])
        ) as { id?: string; callback_url?: string; url?: string }[];
        const mine = list.filter(
          (s) => (s.callback_url ?? s.url) === input.webhookUrl && s.id,
        );
        if (mine.length === 0) r.webhook = "not-found";
        for (const s of mine) {
          const del = await f(`${api}/v2/webhook_subscriptions/${s.id}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...testing,
              ...sign(),
            },
          });
          if (!del.ok && del.status !== 404) {
            throw new Error(`delete ${del.status}`);
          }
          r.webhook = "deleted";
        }
      } catch (e) {
        r.webhook = "failed";
        r.errors.push(`webhook: ${short(e)}`);
      }
    }
  }

  // RFC 7009 token revocation (Qonto's OAuth server); revoking the refresh
  // token invalidates the grant.
  const toRevoke = refreshToken ?? accessToken;
  if (toRevoke && clientId && clientSecret) {
    try {
      const res = await f(`${oauth}/oauth2/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...testing,
        },
        body: new URLSearchParams({
          token: toRevoke,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      r.token = res.ok ? "revoked" : "failed";
      if (!res.ok) r.errors.push(`revoke ${res.status}`);
    } catch (e) {
      r.token = "failed";
      r.errors.push(`revoke: ${short(e)}`);
    }
  }
  if (r.token === "failed" || r.webhook === "failed") {
    r.manualAction =
      "In Qonto, revoke the GetBlitz app connection and delete its webhook.";
  }
  return r;
}

async function wise(input: RevokeInput, f: Fetch): Promise<RevokeResult> {
  const r: RevokeResult = {
    webhook: "none-stored",
    token: "manual",
    manualAction:
      "Wise API tokens cannot be revoked via the API: delete the GetBlitz API token in your Wise business account settings.",
    errors: [],
  };
  const token = str(input.credentials?.apiToken) ?? str(input.config?.apiToken);
  const profileId =
    str(input.credentials?.profileId) ?? str(input.config?.profileId);
  const base =
    input.config?.sandboxMode === true
      ? "https://api.wise-sandbox.com"
      : "https://api.wise.com";
  if (!token) r.token = "none-stored";
  if (!input.webhookUrl) return r;
  if (!token || !profileId) {
    r.webhook = "failed";
    r.errors.push("no token/profile for webhook lookup");
    return r;
  }
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const res = await f(`${base}/v3/profiles/${profileId}/subscriptions`, {
      headers,
    });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const list = (await res.json()) as {
      id?: string;
      delivery?: { url?: string };
    }[];
    const mine = (Array.isArray(list) ? list : []).filter(
      (s) => s.delivery?.url === input.webhookUrl && s.id,
    );
    r.webhook = mine.length === 0 ? "not-found" : r.webhook;
    for (const s of mine) {
      const del = await f(
        `${base}/v3/profiles/${profileId}/subscriptions/${s.id}`,
        { method: "DELETE", headers },
      );
      if (!del.ok && del.status !== 404)
        throw new Error(`delete ${del.status}`);
      r.webhook = "deleted";
    }
  } catch (e) {
    r.webhook = "failed";
    r.errors.push(`webhook: ${short(e)}`);
  }
  return r;
}

export async function revokeAtProvider(
  input: RevokeInput,
  f: Fetch = fetch,
): Promise<RevokeResult> {
  if (!input.config && !input.credentials && !input.webhookUrl) {
    return { webhook: "none-stored", token: "none-stored", errors: [] };
  }
  switch (input.providerId) {
    case "qonto":
      return qonto(input, f);
    case "wise":
      return wise(input, f);
    default:
      return {
        webhook: input.webhookUrl ? "unsupported" : "none-stored",
        token: "unsupported",
        manualAction: `No revocation API implemented for ${input.providerId}: remove GetBlitz access in the bank's dashboard.`,
        errors: [],
      };
  }
}
