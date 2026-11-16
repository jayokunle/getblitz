import { connection } from "next/server";

import { env } from "~/env";

/**
 * Site-wide notice driven by the SHUTDOWN_BANNER env var (read at request
 * time). Renders nothing when the variable is unset, so self-hosted
 * deployments are unaffected.
 */
export async function ShutdownBanner() {
  await connection();
  const text = env.SHUTDOWN_BANNER?.trim();
  if (!text) return null;

  return (
    <div
      role="status"
      className="w-full border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      {text}
    </div>
  );
}
