"use server";

import { revalidatePath } from "next/cache";

import { baseCurrencySchema } from "@/domain/currencies";
import { getPublicErrorMessage } from "@/domain/errors";
import type { FormActionState } from "@/features/forms/action-state";
import { saveBaseCurrency } from "@/features/settings/settings-repository";

export async function updateBaseCurrencyAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const result = baseCurrencySchema.safeParse(formData.get("baseCurrency"));

  if (!result.success) {
    return {
      status: "error",
      message: "Choose a supported reporting currency.",
    };
  }

  try {
    await saveBaseCurrency(result.data);
    revalidatePath("/", "layout");

    return {
      status: "success",
      message: `Reporting currency changed to ${result.data}.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(
        error,
        "The reporting currency could not be changed.",
      ),
    };
  }
}
