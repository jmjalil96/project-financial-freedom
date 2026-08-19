import {
  getReviewBlockers,
  type CanonicalDuplicate,
  type ReviewBlocker,
  type ReviewDecision,
} from "@/domain/review/completeness";
import type { ReconciliationResult } from "@/domain/review/reconciliation";

export type ReviewCategoryState = {
  id: number;
  name: string;
  archivedAt: string | null;
};

export type RowReviewReadinessInput = {
  sourceAmountMinor: number;
  decision: ReviewDecision;
  effectiveDate: string | null;
  accountOpeningDate: string;
  categories: readonly ReviewCategoryState[];
  canonicalDuplicate?: CanonicalDuplicate | null;
  batchFinalized?: boolean;
};

export function getRowReviewBlockers({
  sourceAmountMinor,
  decision,
  effectiveDate,
  accountOpeningDate,
  categories,
  canonicalDuplicate = null,
  batchFinalized = false,
}: RowReviewReadinessInput): ReviewBlocker[] {
  const blockers = getReviewBlockers({
    sourceAmountMinor,
    decision,
    canonicalDuplicate,
  });

  if (decision.disposition !== "accepted") {
    return blockers;
  }

  if (effectiveDate === null) {
    blockers.push({
      code: "effective_date_required",
      field: "effectiveDate",
      message: "Confirm an effective date for every accepted row.",
    });
  } else if (effectiveDate < accountOpeningDate) {
    blockers.push({
      code: "effective_date_before_opening",
      field: "effectiveDate",
      message: `The effective date cannot be before the account opening date (${accountOpeningDate}).`,
    });
  }

  if (!batchFinalized) {
    for (const category of categories) {
      if (category.archivedAt !== null) {
        blockers.push({
          code: "category_inactive",
          field: "allocations",
          message: `${category.name} is archived. Choose an active category.`,
          categoryId: category.id,
        });
      }
    }
  }

  return blockers;
}

export type StatementBatchBlocker =
  | {
      code: "rows_incomplete";
      message: string;
      importRowIds: number[];
    }
  | {
      code: "open_duplicate_candidates";
      message: string;
      candidateIds: number[];
    }
  | {
      code: "inactive_categories";
      message: string;
      categoryIds: number[];
    }
  | {
      code: "reconciliation_difference";
      message: string;
      differenceMinor: number;
    };

export type BatchReadinessRow = {
  id: number;
  blockers: readonly ReviewBlocker[];
  duplicateCandidates: readonly {
    id: number;
    status: "open" | "dismissed" | "confirmed";
  }[];
};

export function getStatementBatchBlockers(
  rows: readonly BatchReadinessRow[],
  reconciliation: ReconciliationResult,
): StatementBatchBlocker[] {
  const blockedRows = rows.filter((row) => row.blockers.length > 0);
  const openCandidateIds = rows.flatMap((row) =>
    row.duplicateCandidates
      .filter((candidate) => candidate.status === "open")
      .map((candidate) => candidate.id),
  );
  const inactiveCategoryIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.blockers.flatMap((blocker) =>
          blocker.code === "category_inactive" && blocker.categoryId !== undefined
            ? [blocker.categoryId]
            : [],
        ),
      ),
    ),
  ];
  const blockers: StatementBatchBlocker[] = [];

  if (blockedRows.length > 0) {
    blockers.push({
      code: "rows_incomplete",
      message: "Complete every row decision before finalizing the statement.",
      importRowIds: blockedRows.map((row) => row.id),
    });
  }
  if (openCandidateIds.length > 0) {
    blockers.push({
      code: "open_duplicate_candidates",
      message: "Confirm or dismiss every open duplicate candidate.",
      candidateIds: openCandidateIds,
    });
  }
  if (inactiveCategoryIds.length > 0) {
    blockers.push({
      code: "inactive_categories",
      message: "Replace archived category allocations before finalizing.",
      categoryIds: inactiveCategoryIds,
    });
  }
  if (reconciliation.differenceMinor !== 0) {
    blockers.push({
      code: "reconciliation_difference",
      message: "The accepted activity does not reconcile to the closing balance.",
      differenceMinor: reconciliation.differenceMinor,
    });
  }

  return blockers;
}
