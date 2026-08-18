"use server";

import { redirect } from "next/navigation";

import { baseCurrencySchema } from "@/domain/currencies";
import { getPublicErrorMessage } from "@/domain/errors";
import { saveBaseCurrency } from "@/features/settings/settings-repository";

export type OnboardingActionState = {
  error: string | null;
};

export async function completeOnboarding(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const result = baseCurrencySchema.safeParse(formData.get("baseCurrency"));

  if (!result.success) {
    return {
      error: "Choose the currency you use for your financial reports.",
    };
  }

  try {
    await saveBaseCurrency(result.data);
  } catch (error) {
    return {
      error: getPublicErrorMessage(error, "Currency setup could not be completed."),
    };
  }

  redirect("/dashboard");
}
