import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DomainError } from "@/domain/errors";
import { listCategories } from "@/features/categories/category-service";
import { getStatementReconciliation } from "@/features/reconciliation/reconciliation-service";
import { StatementReviewWorkspace } from "@/features/reconciliation/statement-review-workspace";

type StatementReviewPageProps = {
  params: Promise<{ batchId: string }>;
};

export async function generateMetadata({
  params,
}: StatementReviewPageProps): Promise<Metadata> {
  const { batchId } = await params;
  return {
    title: /^\d+$/.test(batchId) ? `Review import #${batchId}` : "Import not found",
  };
}

export default async function StatementReviewPage({
  params,
}: StatementReviewPageProps) {
  const rawBatchId = (await params).batchId;
  const batchId = Number(rawBatchId);

  if (!/^\d+$/.test(rawBatchId) || !Number.isSafeInteger(batchId) || batchId <= 0) {
    notFound();
  }

  let statement;
  try {
    statement = await getStatementReconciliation(batchId);
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.message === "The import statement does not exist."
    ) {
      notFound();
    }
    throw error;
  }

  const categories = await listCategories();
  const activeCategories = categories.filter((category) => !category.archivedAt);

  return (
    <StatementReviewWorkspace
      categories={activeCategories}
      rows={statement.rows}
      statement={statement}
    />
  );
}
