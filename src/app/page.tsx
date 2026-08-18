import { redirect } from "next/navigation";

import { OnboardingPage } from "@/features/onboarding/onboarding-page";
import { getApplicationSettings } from "@/features/settings/settings-repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const settings = await getApplicationSettings();

  if (settings) {
    redirect("/dashboard");
  }

  return <OnboardingPage />;
}
