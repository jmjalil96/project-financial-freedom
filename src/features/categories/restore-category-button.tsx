import { restoreCategoryAction } from "@/features/categories/actions";
import { EntityStatusButton } from "@/features/forms/entity-status-button";

export function RestoreCategoryButton({
  categoryId,
  categoryName,
}: {
  categoryId: number;
  categoryName: string;
}) {
  return (
    <EntityStatusButton
      accessibleLabel={`Restore ${categoryName}`}
      action={restoreCategoryAction}
      entityId={categoryId}
      fieldName="categoryId"
      icon="restore"
      label="Restore"
      pendingLabel="Restoring…"
    />
  );
}
