import { createEnv } from "@t3-oss/env-nextjs";
import { coolify } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

import { apiEnv } from "@getblitz/api/env";
import { authEnv } from "@getblitz/auth/env";
import { databaseEnv } from "@getblitz/database/env";
import { redisEnv } from "@getblitz/redis/env";

export const env = createEnv({
  extends: [authEnv(), apiEnv(), databaseEnv(), redisEnv()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    CRON_SECRET: z.string().optional(),
    PROJECT_URL: z.url().default("http://localhost:3000"),
    APPLICATION_ENV: z
      .enum(["development", "production", "preview", "test"])
      .default("development"),
    ENCRYPTION_KEY: z.string().min(32),
    /**
     * "true" blocks creation of new users and organizations (server-side).
     * Existing users can still sign in. Used for the hosted-service shutdown.
     */
    DISABLE_SIGNUPS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Optional notice shown at the top of the dashboard and auth pages. */
    SHUTDOWN_BANNER: z.string().optional(),
    /**
     * Shutdown notice mailer (POST /api/internal/shutdown-notice). The route
     * returns 404 unless SHUTDOWN_NOTICE_SECRET is set (min. 32 chars).
     */
    SHUTDOWN_NOTICE_SECRET: z.string().min(32).optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    SMTP_REPLY_TO: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
    NEXT_PUBLIC_WSS_URL: z.url().default("ws://localhost:3001"),
    NEXT_PUBLIC_APP_VERSION: z.string().optional(),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_WSS_URL: process.env.NEXT_PUBLIC_WSS_URL,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});
