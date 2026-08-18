import { archiveCategoryAction } from "@/features/categories/actions";
import { EntityStatusButton } from "@/features/forms/entity-status-button";

type ArchiveCategoryButtonProps = {
  categoryId: number;
  categoryName: string;
};

export function ArchiveCategoryButton({
  categoryId,
  categoryName,
}: ArchiveCategoryButtonProps) {
  return (
    <EntityStatusButton
      accessibleLabel={`Archive ${categoryName}`}
      action={archiveCategoryAction}
      className="icon-button"
      confirmMessage={`Archive ${categoryName}? Existing entries will keep this category.`}
      entityId={categoryId}
      fieldName="categoryId"
      icon="archive"
      title={`Archive ${categoryName}`}
    />
  );
}
