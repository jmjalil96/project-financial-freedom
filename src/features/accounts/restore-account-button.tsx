import { restoreAccountAction } from "@/features/accounts/actions";
import { EntityStatusButton } from "@/features/forms/entity-status-button";

export function RestoreAccountButton({
  accountId,
  accountName,
}: {
  accountId: number;
  accountName: string;
}) {
  return (
    <EntityStatusButton
      accessibleLabel={`Restore ${accountName}`}
      action={restoreAccountAction}
      entityId={accountId}
      fieldName="accountId"
      icon="restore"
      label="Restore"
      pendingLabel="Restoring…"
      title={`Restore ${accountName} before correcting its history`}
    />
  );
}
