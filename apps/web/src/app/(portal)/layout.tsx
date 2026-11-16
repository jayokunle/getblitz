import { ShutdownBanner } from "~/app/_components/shutdown-banner";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ShutdownBanner />
      {children}
    </>
  );
}
