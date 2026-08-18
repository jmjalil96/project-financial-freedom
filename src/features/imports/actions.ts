"use server";

import { revalidatePath } from "next/cache";

import { getPublicErrorMessage } from "@/domain/errors";
import { maximumCsvFileBytes, type ImportIssue } from "@/features/imports/csv-contract";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
  type ImportValidationResult,
} from "@/features/imports/import-service";

type SourceInputResult =
  | {
      status: "valid";
      input: ImportSourceInput;
    }
  | {
      status: "invalid";
      errors: ImportIssue[];
    };

async function importSourceFromFormData(
  formData: FormData,
): Promise<SourceInputResult> {
  const file = formData.get("file");

  if (!(file instanceof File) || !file.name.trim()) {
    return {
      status: "invalid",
      errors: [
        {
          severity: "error",
          code: "missing_file",
          field: "file",
          message: "Choose a CSV file.",
        },
      ],
    };
  }

  if (file.size > maximumCsvFileBytes) {
    return {
      status: "invalid",
      errors: [
        {
          severity: "error",
          code: "file_too_large",
          field: "file",
          message: "The CSV exceeds the 5 MB file limit.",
        },
      ],
    };
  }

  const rawAccountId = formData.get("financialAccountId");
  const financialAccountId =
    typeof rawAccountId === "string" ? Number(rawAccountId) : Number.NaN;

  return {
    status: "valid",
    input: {
      financialAccountId,
      statementStartDate: String(formData.get("statementStartDate") ?? ""),
      statementEndDate: String(formData.get("statementEndDate") ?? ""),
      openingBalance: String(formData.get("openingBalance") ?? ""),
      closingBalance: String(formData.get("closingBalance") ?? ""),
      sourceFilename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
  };
}

export async function previewCsvImportAction(
  formData: FormData,
): Promise<ImportValidationResult> {
  const source = await importSourceFromFormData(formData);

  if (source.status === "invalid") {
    return source;
  }

  try {
    return await validateImportSource(source.input);
  } catch (error) {
    return {
      status: "invalid",
      errors: [
        {
          severity: "error",
          code: "preview_failed",
          message: getPublicErrorMessage(error, "The CSV could not be previewed."),
        },
      ],
    };
  }
}

export async function commitCsvImportAction(
  formData: FormData,
  approvalToken: string,
): Promise<
  | {
      status: "invalid";
      errors: ImportIssue[];
    }
  | {
      status: "committed";
      batchId: number;
      rowCount: number;
    }
> {
  const source = await importSourceFromFormData(formData);

  if (source.status === "invalid") {
    return source;
  }

  try {
    const result = await commitValidatedImport(source.input, approvalToken);

    if (result.status === "committed") {
      revalidatePath("/imports");
    }

    return result;
  } catch (error) {
    return {
      status: "invalid",
      errors: [
        {
          severity: "error",
          code: "commit_failed",
          message: getPublicErrorMessage(error, "The import could not be committed."),
        },
      ],
    };
  }
}
