import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { oAuthProxy, organization } from "better-auth/plugins";

import { prisma } from "@getblitz/database";

export function initAuth<
  TExtraPlugins extends BetterAuthPlugin[] = [],
>(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;
  googleClientId: string;
  googleClientSecret: string;
  extraPlugins: TExtraPlugins;
  /**
   * When true, no new users or organizations can be created (server-side):
   * Google sign-in only works for existing accounts, email/password sign-up
   * stays off, and organization creation is rejected. Existing users can
   * still sign in.
   */
  disableSignUp?: boolean;
}) {
  const disableSignUp = options.disableSignUp ?? false;

  const config = {
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    plugins: [
      oAuthProxy({
        productionURL: options.productionUrl,
        currentURL: options.baseUrl,
      }),
      organization({
        allowUserToCreateOrganization: !disableSignUp,
      }),
      apiKey([
        {
          configId: "org-keys",
          defaultPrefix: "sk_",
          references: "organization",
        },
      ]),
      ...options.extraPlugins,
    ],
    emailAndPassword: {
      enabled: false,
      disableSignUp: true,
    },
    socialProviders: {
      google: {
        disableSignUp,
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        redirectURI: `${options.productionUrl}/api/auth/callback/google`,
      },
    },
    onAPIError: {
      onError(error, ctx) {
        console.error("BETTER AUTH API ERROR", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

// Declared as an interface (not a type alias) so TypeScript references it by
// name in emitted declarations instead of expanding the full better-auth type,
// which otherwise exceeds the compiler's serialization limit (TS7056).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Auth extends ReturnType<typeof initAuth> {}
export type Session = Auth["$Infer"]["Session"];
