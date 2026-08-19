"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { calendarDateSchema } from "@/domain/calendar-date";
import { getPublicErrorMessage } from "@/domain/errors";
import { parseMoneyToMinorUnits } from "@/domain/money";
import { confirmedTypes, dispositions } from "@/domain/review";
import type { FormActionState } from "@/features/forms/action-state";
import { finalizeImportBatch } from "@/features/reconciliation/finalization-service";
import { postFinalizedImportBatch } from "@/features/reconciliation/import-posting-service";
import {
  dismissDuplicateCandidate,
  getReviewRowContext,
  saveRowDecision,
} from "@/features/reconciliation/review-service";

const optionalText = (maximumLength: number) =>
  z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.string().trim().max(maximumLength).optional(),
  );

const optionalPositiveInteger = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const saveDecisionSchema = z.object({
  importRowId: z.coerce.number().int().positive(),
  disposition: z.enum(dispositions),
  confirmedType: z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.enum(confirmedTypes).optional(),
  ),
  effectiveDate: z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    calendarDateSchema.optional(),
  ),
  normalizedMerchant: optionalText(140),
  reviewNote: optionalText(500),
  exclusionReason: optionalText(500),
  duplicateOfImportRowId: optionalPositiveInteger,
  categoryIds: z.array(z.coerce.number().int().positive()),
  categoryAmounts: z.array(z.string().trim().min(1)),
});

function getArrayValues(
  formData: FormData,
  pluralName: string,
  singularName: string,
): FormDataEntryValue[] {
  const pluralValues = formData.getAll(pluralName);
  return pluralValues.length > 0 ? pluralValues : formData.getAll(singularName);
}

function revalidateReviewPaths(batchId: number): void {
  revalidatePath("/review");
  revalidatePath("/imports");
  revalidatePath(`/imports/${batchId}/review`);
}

export async function saveRowDecisionAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = saveDecisionSchema.safeParse({
    importRowId: formData.get("importRowId"),
    disposition: formData.get("disposition"),
    confirmedType: formData.get("confirmedType"),
    effectiveDate: formData.get("effectiveDate"),
    normalizedMerchant: formData.get("normalizedMerchant"),
    reviewNote: formData.get("reviewNote"),
    exclusionReason: formData.get("exclusionReason"),
    duplicateOfImportRowId: formData.get("duplicateOfImportRowId"),
    categoryIds: getArrayValues(formData, "categoryIds", "categoryId"),
    categoryAmounts: getArrayValues(formData, "categoryAmounts", "categoryAmount"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the row decision.",
    };
  }
  if (parsed.data.categoryIds.length !== parsed.data.categoryAmounts.length) {
    return {
      status: "error",
      message: "Every category allocation needs an amount.",
    };
  }

  try {
    const context = await getReviewRowContext(parsed.data.importRowId);
    if (!context) {
      return {
        status: "error",
        message: "The import row does not exist.",
      };
    }
    const allocations = parsed.data.categoryIds.map((categoryId, index) => ({
      categoryId,
      amountMinor: parseMoneyToMinorUnits(
        parsed.data.categoryAmounts[index]!,
        context.currency,
        { allowNegative: false, allowZero: false },
      ),
    }));
    const result = await saveRowDecision({
      importRowId: parsed.data.importRowId,
      disposition: parsed.data.disposition,
      confirmedType: parsed.data.confirmedType,
      effectiveDate: parsed.data.effectiveDate,
      normalizedMerchant: parsed.data.normalizedMerchant,
      reviewNote: parsed.data.reviewNote,
      exclusionReason: parsed.data.exclusionReason,
      duplicateOfImportRowId: parsed.data.duplicateOfImportRowId,
      allocations,
    });
    revalidateReviewPaths(result.batchId);
    return {
      status: "success",
      message: "The row decision was saved.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The row decision could not be saved."),
    };
  }
}

const candidateSchema = z.object({
  candidateId: z.coerce.number().int().positive(),
});

export async function dismissDuplicateCandidateAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = candidateSchema.safeParse({
    candidateId: formData.get("candidateId") ?? formData.get("duplicateCandidateId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "The duplicate candidate identifier is invalid.",
    };
  }

  try {
    const result = await dismissDuplicateCandidate(parsed.data.candidateId);
    revalidateReviewPaths(result.batchId);
    return {
      status: "success",
      message: "The duplicate candidate was dismissed.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(
        error,
        "The duplicate candidate could not be dismissed.",
      ),
    };
  }
}

const finalizeSchema = z.object({
  importBatchId: z.coerce.number().int().positive(),
});

export async function finalizeImportBatchAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = finalizeSchema.safeParse({
    importBatchId: formData.get("importBatchId") ?? formData.get("batchId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "The import statement identifier is invalid.",
    };
  }

  try {
    const result = await finalizeImportBatch(parsed.data.importBatchId);
    revalidateReviewPaths(result.batchId);
    revalidatePath("/transactions");
    revalidatePath("/coverage");
    return {
      status: "success",
      message: `The statement was finalized and ${result.journalEntryCount} ${
        result.journalEntryCount === 1 ? "entry was" : "entries were"
      } posted.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The statement could not be finalized."),
    };
  }
}

export const finalizeStatementAction = finalizeImportBatchAction;

export async function postFinalizedImportBatchAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = finalizeSchema.safeParse({
    importBatchId: formData.get("importBatchId") ?? formData.get("batchId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "The import statement identifier is invalid.",
    };
  }
  try {
    const result = await postFinalizedImportBatch(parsed.data.importBatchId);
    revalidateReviewPaths(result.batchId);
    revalidatePath("/transactions");
    revalidatePath("/coverage");
    return {
      status: "success",
      message: `${result.journalEntryCount} imported ledger ${
        result.journalEntryCount === 1 ? "entry was" : "entries were"
      } posted.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(
        error,
        "The finalized statement could not be posted.",
      ),
    };
  }
}
