import type { ReviewBlocker, ReviewDecision } from "@/domain/review/completeness";
import {
  inboxFilters,
  type ConfirmedType,
  type InboxFilter,
} from "@/domain/review/schemas";

export type InboxWarning = {
  code: string;
  field?: string | null;
};

export type InboxRowState = {
  warnings: readonly InboxWarning[];
  duplicateCandidates: readonly unknown[];
  transferCandidates: readonly unknown[];
  possibleTransfer?: boolean;
  suggestedType?: ConfirmedType | null;
  decision: ReviewDecision;
  blockers: readonly ReviewBlocker[];
};

const categoryBlockerCodes = new Set<ReviewBlocker["code"]>([
  "category_allocation_required",
  "category_allocation_invalid_category",
  "category_allocation_invalid_amount",
  "category_allocation_duplicate",
  "category_allocation_kind_mismatch",
  "category_allocation_total_mismatch",
]);

function hasDateWarning(warnings: readonly InboxWarning[]): boolean {
  return warnings.some(
    (warning) =>
      warning.code.includes("date") ||
      warning.field === "transaction_date" ||
      warning.field === "posted_date" ||
      warning.field === "effective_date",
  );
}

function hasReconciliationWarning(warnings: readonly InboxWarning[]): boolean {
  return warnings.some(
    (warning) =>
      warning.code === "reconciliation_blocker" ||
      warning.code.startsWith("reconciliation_"),
  );
}

export function deriveInboxFilters(row: InboxRowState): InboxFilter[] {
  const filters = new Set<InboxFilter>();
  const { decision } = row;
  const acceptedOrUndecided =
    decision.disposition === null || decision.disposition === "accepted";

  if (row.blockers.some((blocker) => categoryBlockerCodes.has(blocker.code))) {
    filters.add("needs_category");
  }
  if (
    decision.disposition === null &&
    (row.suggestedType === "income" ||
      row.suggestedType === "expense" ||
      row.suggestedType === "refund")
  ) {
    filters.add("needs_category");
  }

  if (
    acceptedOrUndecided &&
    decision.confirmedType === null &&
    (row.suggestedType ?? null) === null
  ) {
    filters.add("unknown_type");
  }

  if (row.duplicateCandidates.length > 0) {
    filters.add("suspected_duplicate");
  }

  if (
    (row.possibleTransfer || row.transferCandidates.length > 0) &&
    (decision.disposition === null ||
      (decision.disposition === "accepted" && decision.confirmedType === null))
  ) {
    filters.add("possible_transfer");
  }

  if (
    acceptedOrUndecided &&
    !decision.effectiveDateConfirmed &&
    hasDateWarning(row.warnings)
  ) {
    filters.add("date_uncertainty");
  }

  if (row.blockers.length > 0 || hasReconciliationWarning(row.warnings)) {
    filters.add("reconciliation_blocker");
  }

  if (filters.size === 0) {
    filters.add("ready_to_finalize");
  }

  return inboxFilters.filter((filter) => filters.has(filter));
}

export function matchesInboxFilter(row: InboxRowState, filter: InboxFilter): boolean {
  return deriveInboxFilters(row).includes(filter);
}

export function filterInboxRows<Row extends InboxRowState>(
  rows: readonly Row[],
  filter: InboxFilter,
): Row[] {
  return rows.filter((row) => matchesInboxFilter(row, filter));
}
