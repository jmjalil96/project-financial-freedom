import type { Metadata } from "next";

import { getPublicErrorMessage } from "@/domain/errors";
import { DataSafetyWorkspace } from "@/features/recovery/data-safety-workspace";
import {
  getBackupRestorePreview,
  getRecoveryWorkspace,
  type BackupRestorePreview,
} from "@/features/recovery/recovery-service";

export const metadata: Metadata = {
  title: "Backups and exports",
};

export default async function DataSafetyPage({
  searchParams,
}: {
  searchParams: Promise<{ restore?: string }>;
}) {
  const requestedRestore = (await searchParams).restore;
  const workspace = await getRecoveryWorkspace();
  let preview: BackupRestorePreview | null = null;
  let previewError: string | null = null;
  if (requestedRestore) {
    try {
      preview = await getBackupRestorePreview(requestedRestore);
    } catch (error) {
      previewError = getPublicErrorMessage(
        error,
        "The selected snapshot could not be inspected.",
      );
    }
  }
  return (
    <DataSafetyWorkspace
      backupDirectory={workspace.backupDirectory}
      backups={workspace.backups}
      preview={preview}
      previewError={previewError}
    />
  );
}
