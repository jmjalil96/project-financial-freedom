"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPublicErrorMessage } from "@/domain/errors";
import type { FormActionState } from "@/features/forms/action-state";
import {
  createManualDatabaseBackup,
  restoreDatabaseBackup,
} from "@/features/recovery/recovery-service";

export async function createManualBackupAction(
  _previousState: FormActionState,
  _formData: FormData,
): Promise<FormActionState> {
  void _previousState;
  void _formData;
  try {
    const backup = await createManualDatabaseBackup();
    revalidatePath("/settings/data");
    return {
      status: "success",
      message: `${backup.filename} was created and verified.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The safety backup could not be created."),
    };
  }
}

const restoreSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  confirmation: z.literal("RESTORE", {
    error: "Type RESTORE exactly to confirm database replacement.",
  }),
  acknowledged: z.literal("on", {
    error: "Acknowledge that newer live changes will be replaced.",
  }),
});

export async function restoreBackupAction(
  _previousState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = restoreSchema.safeParse({
    filename: formData.get("filename"),
    confirmation: formData.get("confirmation"),
    acknowledged: formData.get("acknowledged"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Review the restore confirmation.",
    };
  }
  try {
    const result = await restoreDatabaseBackup(parsed.data.filename);
    revalidatePath("/", "layout");
    return {
      status: "success",
      message: `${result.filename} was restored successfully. A safety copy of the replaced database remains as ${result.safetyBackupFilename}.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getPublicErrorMessage(error, "The backup could not be restored."),
    };
  }
}
