"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { financialAccountTypeSchema } from "@/domain/accounts";
import { calendarDateSchema } from "@/domain/calendar-date";
import { getPublicErrorMessage } from "@/domain/errors";
import { parseMoneyToMinorUnits } from "@/domain/money";
import {
  archiveFinancialAccount,
  createFinancialAccount,
  restoreFinancialAccount,
} from "@/features/accounts/account-service";
import type { FormActionState } from "@/features/forms/action-state";
import { getApplicationSettings } from "@/features/settings/settings-repository";

const accountSchema = z.object({
  name: z.string().trim().min(1, "Enter an account name.").max(80),
  institution: z.string().trim().max(80).optional(),
  type: financialAccountTypeSchema,
  openingDate: calendarDateSchema,
  openingBalance: z.string().trim().min(1),
  requiredForClose: z.boolean(),
});

export async function createAccountAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = accountSchema.safeParse({
    name: formData.get("name"),
    institution: formData.get("institution") || undefined,
    type: formData.get("type"),
    openingDate: formData.get("openingDate"),
    openingBalance: formData.get("openingBalance"),
    requiredForClose: formData.get("requiredForClose") === "on",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the account details.",
    };
  }

  const settings = await getApplicationSettings();

  if (!settings) {
    return {
      status: "error",
      message: "Complete currency setup before creating an account.",
    };
  }

  try {
    const openingBalanceMinor = parseMoneyToMinorUnits(
      parsed.data.openingBalance,
      settings.baseCurrency,
    );

    await createFinancialAccount({
      name: parsed.data.name,
      institution: parsed.data.institution,
      type: parsed.data.type,
      openingDate: parsed.data.openingDate,
      openingBalanceMinor,
      requiredForClose: parsed.data.requiredForClose,
    });

    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath("/coverage");

    return {
      status: "success",
      message: `${parsed.data.name} was added with a balanced opening position.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The account could not be added."),
    };
  }
}

const accountIdSchema = z.coerce.number().int().positive();
const archiveSchema = z.object({
  accountId: accountIdSchema,
  archivedOn: calendarDateSchema.optional(),
});

export async function archiveAccountAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = archiveSchema.safeParse({
    accountId: formData.get("accountId"),
    archivedOn: formData.get("archivedOn") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the account closing date.",
    };
  }

  try {
    await archiveFinancialAccount(parsed.data.accountId, parsed.data.archivedOn);
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    revalidatePath("/coverage");

    return {
      status: "success",
      message: "The zero-balance account was archived.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The account could not be archived."),
    };
  }
}

export async function restoreAccountAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const accountId = accountIdSchema.safeParse(formData.get("accountId"));

  if (!accountId.success) {
    return {
      status: "error",
      message: "The account identifier is invalid.",
    };
  }

  try {
    await restoreFinancialAccount(accountId.data);
    revalidatePath("/accounts");
    revalidatePath("/transactions");
    revalidatePath("/dashboard");
    revalidatePath("/coverage");

    return {
      status: "success",
      message: "The account is active again.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The account could not be restored."),
    };
  }
}
