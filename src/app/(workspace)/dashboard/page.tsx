import type { Metadata } from "next";

import { DashboardWorkspace } from "@/features/dashboard/dashboard-workspace";
import { getDashboardWorkspace } from "@/features/dashboard/dashboard-service";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const workspace = await getDashboardWorkspace();
  return <DashboardWorkspace workspace={workspace} />;
}
