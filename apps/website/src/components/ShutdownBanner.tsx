import { useTranslations } from "next-intl";

export function ShutdownBanner() {
  const t = useTranslations();
  return (
    <div
      role="status"
      className="w-full border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      {t("shutdownBanner")}
    </div>
  );
}
