"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPublicErrorMessage } from "@/domain/errors";
import { calendarMonthSchema } from "@/domain/monthly-report";
import type { FormActionState } from "@/features/forms/action-state";
import { closeMonth, reopenMonth } from "@/features/month-close/month-close-service";

function revalidateMonthlyReview(): void {
  revalidatePath("/month-close");
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/net-worth");
}

export async function closeMonthAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const targetMonth = calendarMonthSchema.safeParse(formData.get("targetMonth"));
  if (!targetMonth.success) {
    return { status: "error", message: "Choose a valid calendar month." };
  }
  if (formData.get("confirmed") !== "on") {
    return {
      status: "error",
      message: "Confirm that you reviewed the report and closing evidence.",
    };
  }
  try {
    await closeMonth(targetMonth.data);
    revalidateMonthlyReview();
    return {
      status: "success",
      message: `${targetMonth.data} is closed with an immutable report revision.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The month could not be closed."),
    };
  }
}

const reopenSchema = z.object({
  targetMonth: calendarMonthSchema,
  reason: z.string().trim().min(1, "Explain why this month must be reopened.").max(500),
});

export async function reopenMonthAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = reopenSchema.safeParse({
    targetMonth: formData.get("targetMonth"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the reopening reason.",
    };
  }
  try {
    const result = await reopenMonth(parsed.data);
    revalidateMonthlyReview();
    return {
      status: "success",
      message: `${result.invalidatedMonths.join(", ")} ${result.invalidatedMonths.length === 1 ? "is" : "are"} provisional until closed again. Prior revisions remain available.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The month could not be reopened."),
    };
  }
}
