"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { calendarDateSchema } from "@/domain/calendar-date";
import { getPublicErrorMessage } from "@/domain/errors";
import { parseMoneyToMinorUnits } from "@/domain/money";
import { manualTransactionKinds } from "@/domain/transactions";
import type { FormActionState } from "@/features/forms/action-state";
import { reverseJournalEntry } from "@/features/ledger/ledger-service";
import { getApplicationSettings } from "@/features/settings/settings-repository";
import { createManualTransaction } from "@/features/transactions/manual-transaction-service";

const optionalPositiveInteger = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const manualTransactionSchema = z.object({
  kind: z.enum(manualTransactionKinds),
  effectiveDate: calendarDateSchema,
  description: z.string().trim().min(1, "Enter a description.").max(140),
  amount: z.string().trim().min(1),
  financialAccountId: z.coerce.number().int().positive(),
  categoryId: optionalPositiveInteger,
  destinationFinancialAccountId: optionalPositiveInteger,
  adjustmentDirection: z.enum(["increase", "decrease"]).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function createManualTransactionAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = manualTransactionSchema.safeParse({
    kind: formData.get("kind"),
    effectiveDate: formData.get("effectiveDate"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    financialAccountId: formData.get("financialAccountId"),
    categoryId: formData.get("categoryId"),
    destinationFinancialAccountId: formData.get("destinationFinancialAccountId"),
    adjustmentDirection: formData.get("adjustmentDirection") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the transaction details.",
    };
  }

  const settings = await getApplicationSettings();

  if (!settings) {
    return {
      status: "error",
      message: "Complete currency setup before recording a transaction.",
    };
  }

  try {
    const amountMinor = parseMoneyToMinorUnits(
      parsed.data.amount,
      settings.baseCurrency,
      {
        allowNegative: false,
        allowZero: false,
      },
    );

    await createManualTransaction({
      ...parsed.data,
      amountMinor,
    });

    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: "The balanced journal entry was posted.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The transaction could not be posted."),
    };
  }
}

const reversalSchema = z.object({
  journalEntryId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, "Explain why this entry is being reversed."),
});

export async function reverseJournalEntryAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = reversalSchema.safeParse({
    journalEntryId: formData.get("journalEntryId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the reversal.",
    };
  }

  try {
    await reverseJournalEntry(parsed.data);
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/dashboard");

    return {
      status: "success",
      message: "A balanced reversal was posted. The original remains visible.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The entry could not be reversed."),
    };
  }
}
