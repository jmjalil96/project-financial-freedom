import { archiveAccountAction } from "@/features/accounts/actions";
import { EntityStatusButton } from "@/features/forms/entity-status-button";

type ArchiveAccountButtonProps = {
  accountId: number;
  accountName: string;
  disabled: boolean;
};

export function ArchiveAccountButton({
  accountId,
  accountName,
  disabled,
}: ArchiveAccountButtonProps) {
  return (
    <EntityStatusButton
      accessibleLabel={`Archive ${accountName}`}
      action={archiveAccountAction}
      confirmMessage={`Archive ${accountName}? Its history will remain visible.`}
      disabled={disabled}
      entityId={accountId}
      fieldName="accountId"
      icon="archive"
      label="Archive"
      pendingLabel="Archiving…"
      title={
        disabled
          ? "Bring the account balance to zero before archiving."
          : `Archive ${accountName}`
      }
    />
  );
}
