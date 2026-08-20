"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPublicErrorMessage } from "@/domain/errors";
import { parseMoneyToMinorUnits } from "@/domain/money";
import { calendarMonthSchema } from "@/domain/monthly-report";
import {
  copyPreviousMonthBudgets,
  setMonthlyBudget,
} from "@/features/budgets/budget-service";
import type { FormActionState } from "@/features/forms/action-state";
import { getApplicationSettings } from "@/features/settings/settings-repository";

function revalidateMonthlyReview(): void {
  revalidatePath("/budgets");
  revalidatePath("/month-close");
  revalidatePath("/dashboard");
}

const targetSchema = z.object({
  targetMonth: calendarMonthSchema,
  categoryId: z.coerce.number().int().positive(),
  amount: z.string().trim().min(1, "Enter a monthly target."),
});

export async function setMonthlyBudgetAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = targetSchema.safeParse({
    targetMonth: formData.get("targetMonth"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the budget target.",
    };
  }
  const settings = await getApplicationSettings();
  if (!settings) {
    return { status: "error", message: "Complete currency setup first." };
  }
  try {
    const amountMinor = parseMoneyToMinorUnits(
      parsed.data.amount,
      settings.baseCurrency,
      { allowNegative: false },
    );
    await setMonthlyBudget({
      targetMonth: parsed.data.targetMonth,
      categoryId: parsed.data.categoryId,
      amountMinor,
    });
    revalidateMonthlyReview();
    return {
      status: "success",
      message: "The monthly category target was saved without rollover.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The budget target could not be saved."),
    };
  }
}

export async function copyPreviousMonthBudgetsAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const targetMonth = calendarMonthSchema.safeParse(formData.get("targetMonth"));
  if (!targetMonth.success) {
    return { status: "error", message: "Choose a valid target month." };
  }
  try {
    const result = await copyPreviousMonthBudgets(targetMonth.data);
    revalidateMonthlyReview();
    return {
      status: "success",
      message:
        result.copiedCount === 0
          ? `No missing targets were available to copy from ${result.sourceMonth}.`
          : `${result.copiedCount} ${result.copiedCount === 1 ? "target was" : "targets were"} copied from ${result.sourceMonth}; ${result.skippedCount} existing ${result.skippedCount === 1 ? "target was" : "targets were"} preserved.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(
        error,
        "The previous month's targets could not be copied.",
      ),
    };
  }
}
