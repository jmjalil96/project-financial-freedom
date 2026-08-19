"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPublicErrorMessage } from "@/domain/errors";
import type { FormActionState } from "@/features/forms/action-state";
import {
  classifyTransfer,
  clearTransferClassification,
  confirmTransferMatch,
} from "@/features/transfers/transfer-service";

const rowSchema = z.coerce.number().int().positive();
const classificationSchema = z.enum(["external_out", "external_in", "in_transit"]);

function revalidateTransfers(): void {
  revalidatePath("/transfers");
  revalidatePath("/review");
  revalidatePath("/month-close");
}

export async function classifyTransferAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = z
    .object({
      importRowId: rowSchema,
      classification: classificationSchema,
    })
    .safeParse({
      importRowId: formData.get("importRowId"),
      classification: formData.get("classification"),
    });
  if (!parsed.success) {
    return { status: "error", message: "Choose a valid transfer classification." };
  }
  try {
    await classifyTransfer(parsed.data);
    revalidateTransfers();
    return { status: "success", message: "Transfer classification saved." };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The transfer could not be classified."),
    };
  }
}

export async function confirmTransferMatchAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = z
    .object({
      importRowId: rowSchema,
      counterpartImportRowId: rowSchema,
    })
    .safeParse({
      importRowId: formData.get("importRowId"),
      counterpartImportRowId: formData.get("counterpartImportRowId"),
    });
  if (!parsed.success) {
    return { status: "error", message: "Choose a valid transfer counterpart." };
  }
  try {
    await confirmTransferMatch(parsed.data);
    revalidateTransfers();
    return { status: "success", message: "Transfer match confirmed." };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The transfer match could not be saved."),
    };
  }
}

export async function clearTransferClassificationAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const importRowId = rowSchema.safeParse(formData.get("importRowId"));
  if (!importRowId.success) {
    return { status: "error", message: "The transfer identifier is invalid." };
  }
  try {
    await clearTransferClassification(importRowId.data);
    revalidateTransfers();
    return { status: "success", message: "Transfer resolution cleared." };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(
        error,
        "The transfer resolution could not be cleared.",
      ),
    };
  }
}
