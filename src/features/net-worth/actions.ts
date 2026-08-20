"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { calendarDateSchema } from "@/domain/calendar-date";
import { getPublicErrorMessage } from "@/domain/errors";
import { parseMoneyToMinorUnits } from "@/domain/money";
import { manualItemKinds, valuationFrequencies } from "@/domain/net-worth";
import type { FormActionState } from "@/features/forms/action-state";
import {
  archiveManualItem,
  carryForwardManualValuation,
  createManualItem,
  recordManualValuation,
  restoreManualItem,
  setOutsideScopeTransferManualItem,
} from "@/features/net-worth/net-worth-service";
import { getApplicationSettings } from "@/features/settings/settings-repository";

const manualItemIdSchema = z.coerce.number().int().positive();

const createManualItemSchema = z.object({
  name: z.string().trim().min(1, "Enter a manual item name.").max(80),
  description: z.string().trim().max(240).optional(),
  kind: z.enum(manualItemKinds),
  openingDate: calendarDateSchema,
  valuationFrequency: z.enum(valuationFrequencies),
});

function revalidateNetWorth(): void {
  revalidatePath("/net-worth");
  revalidatePath("/dashboard");
  revalidatePath("/transfers");
}

export async function createManualItemAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = createManualItemSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    kind: formData.get("kind"),
    openingDate: formData.get("openingDate"),
    valuationFrequency: formData.get("valuationFrequency"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the manual item details.",
    };
  }
  try {
    await createManualItem(parsed.data);
    revalidateNetWorth();
    return {
      status: "success",
      message: `${parsed.data.name} was added without creating ledger income or expense.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The manual item could not be added."),
    };
  }
}

const valuationSchema = z.object({
  manualItemId: manualItemIdSchema,
  effectiveDate: calendarDateSchema,
  value: z.string().trim().min(1, "Enter a value."),
  sourceNote: z.string().trim().min(1, "Record where this value came from.").max(500),
});

export async function recordManualValuationAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = valuationSchema.safeParse({
    manualItemId: formData.get("manualItemId"),
    effectiveDate: formData.get("effectiveDate"),
    value: formData.get("value"),
    sourceNote: formData.get("sourceNote"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the valuation details.",
    };
  }
  const settings = await getApplicationSettings();
  if (!settings) {
    return { status: "error", message: "Complete currency setup first." };
  }
  try {
    const naturalValueMinor = parseMoneyToMinorUnits(
      parsed.data.value,
      settings.baseCurrency,
    );
    if (naturalValueMinor < 0) {
      return {
        status: "error",
        message: "Enter manual asset values and amounts owed as nonnegative amounts.",
      };
    }
    await recordManualValuation({
      manualItemId: parsed.data.manualItemId,
      effectiveDate: parsed.data.effectiveDate,
      naturalValueMinor,
      sourceNote: parsed.data.sourceNote,
    });
    revalidateNetWorth();
    return {
      status: "success",
      message: "The dated valuation was recorded without rewriting prior history.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The valuation could not be recorded."),
    };
  }
}

const carryForwardSchema = z.object({
  manualItemId: manualItemIdSchema,
  sourceValuationId: z.coerce.number().int().positive(),
  effectiveDate: calendarDateSchema,
  acknowledgment: z
    .string()
    .trim()
    .min(1, "Explain why the prior value is still appropriate.")
    .max(500),
});

export async function carryForwardManualValuationAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = carryForwardSchema.safeParse({
    manualItemId: formData.get("manualItemId"),
    sourceValuationId: formData.get("sourceValuationId"),
    effectiveDate: formData.get("effectiveDate"),
    acknowledgment: formData.get("acknowledgment"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the carry-forward details.",
    };
  }
  try {
    await carryForwardManualValuation(parsed.data);
    revalidateNetWorth();
    return {
      status: "success",
      message: "The prior value was carried forward with an explicit acknowledgment.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The value could not be carried forward."),
    };
  }
}

const archiveSchema = z.object({
  manualItemId: manualItemIdSchema,
  archivedOn: calendarDateSchema.optional(),
});

export async function archiveManualItemAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = archiveSchema.safeParse({
    manualItemId: formData.get("manualItemId"),
    archivedOn: formData.get("archivedOn") || undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the closing date.",
    };
  }
  try {
    await archiveManualItem(parsed.data.manualItemId, parsed.data.archivedOn);
    revalidateNetWorth();
    return { status: "success", message: "The manual item was archived." };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The manual item could not be archived."),
    };
  }
}

export async function restoreManualItemAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = manualItemIdSchema.safeParse(formData.get("manualItemId"));
  if (!parsed.success) {
    return { status: "error", message: "The manual item identifier is invalid." };
  }
  try {
    await restoreManualItem(parsed.data);
    revalidateNetWorth();
    return { status: "success", message: "The manual item is active again." };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The manual item could not be restored."),
    };
  }
}

const transferLinkSchema = z.object({
  transferResolutionId: z.coerce.number().int().positive(),
  manualItemId: z.union([manualItemIdSchema, z.null()]),
});

export async function setOutsideScopeTransferManualItemAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const rawManualItemId = formData.get("manualItemId");
  const parsed = transferLinkSchema.safeParse({
    transferResolutionId: formData.get("transferResolutionId"),
    manualItemId:
      typeof rawManualItemId === "string" && rawManualItemId.trim()
        ? rawManualItemId
        : null,
  });
  if (!parsed.success) {
    return { status: "error", message: "Choose a valid transfer and manual item." };
  }
  try {
    await setOutsideScopeTransferManualItem(parsed.data);
    revalidateNetWorth();
    return {
      status: "success",
      message: parsed.data.manualItemId
        ? "The transfer now resolves into that manual valuation instead of being counted twice."
        : "The transfer is no longer linked to a manual valuation.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The transfer link could not be changed."),
    };
  }
}
