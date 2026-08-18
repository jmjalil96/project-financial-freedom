import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getDatabaseContext } from "@/db/client";
import { getApplicationSettings } from "@/features/settings/settings-repository";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [context, settings] = await Promise.all([
    getDatabaseContext(),
    getApplicationSettings(),
  ]);

  if (!settings) {
    redirect("/");
  }

  return (
    <AppShell
      baseCurrency={settings.baseCurrency}
      storageLabel={
        context.paths.storageLocation === "default_local"
          ? "Stored on this Mac"
          : "Configured data location"
      }
    >
      {children}
    </AppShell>
  );
}
