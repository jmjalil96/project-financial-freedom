import { DomainError } from "@/domain/errors";
import { sumMinorUnits } from "@/domain/money";
import type { ConfirmedType, Disposition } from "@/domain/review/schemas";

export type CategoryKind = "income" | "expense";

export type CategoryAllocation = {
  categoryId: number;
  categoryKind: CategoryKind;
  amountMinor: number;
};

export type ReviewDecision = {
  disposition: Disposition | null;
  confirmedType: ConfirmedType | null;
  allocations: readonly CategoryAllocation[];
  note: string | null;
  exclusionReason: string | null;
  duplicateOfRowId: number | null;
  effectiveDateConfirmed?: boolean;
};

export type CanonicalDuplicate = {
  rowId: number;
  disposition: Disposition | null;
};

export type ReviewBlockerCode =
  | "decision_required"
  | "confirmed_type_required"
  | "transaction_type_amount_direction"
  | "category_allocation_required"
  | "category_allocation_invalid_category"
  | "category_allocation_invalid_amount"
  | "category_allocation_duplicate"
  | "category_allocation_kind_mismatch"
  | "category_allocation_total_mismatch"
  | "zero_amount_not_allocatable"
  | "category_not_allowed"
  | "adjustment_note_required"
  | "exclusion_reason_required"
  | "duplicate_canonical_required"
  | "duplicate_canonical_not_accepted"
  | "effective_date_required"
  | "effective_date_before_opening"
  | "category_inactive";

export type ReviewBlocker = {
  code: ReviewBlockerCode;
  field:
    | "disposition"
    | "confirmedType"
    | "allocations"
    | "effectiveDate"
    | "note"
    | "exclusionReason"
    | "duplicateOfRowId";
  message: string;
  allocationIndex?: number;
  expectedAmountMinor?: number;
  actualAmountMinor?: number;
  categoryId?: number;
};

export type ReviewCompletenessInput = {
  sourceAmountMinor: number;
  decision: ReviewDecision;
  canonicalDuplicate?: CanonicalDuplicate | null;
};

function nonblank(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function categoryBlockers(
  allocations: readonly CategoryAllocation[],
  expectedKind: CategoryKind,
  expectedAmountMinor: number,
): ReviewBlocker[] {
  if (allocations.length === 0) {
    return [
      {
        code: "category_allocation_required",
        field: "allocations",
        message: "Assign the full amount to at least one category.",
        expectedAmountMinor,
        actualAmountMinor: 0,
      },
    ];
  }

  const blockers: ReviewBlocker[] = [];
  const categoryIds = new Set<number>();
  let amountsAreValid = true;

  allocations.forEach((allocation, allocationIndex) => {
    if (!Number.isSafeInteger(allocation.categoryId) || allocation.categoryId <= 0) {
      blockers.push({
        code: "category_allocation_invalid_category",
        field: "allocations",
        message: "Choose a valid category.",
        allocationIndex,
      });
    } else if (categoryIds.has(allocation.categoryId)) {
      blockers.push({
        code: "category_allocation_duplicate",
        field: "allocations",
        message: "Combine allocations that use the same category.",
        allocationIndex,
      });
    } else {
      categoryIds.add(allocation.categoryId);
    }

    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor <= 0) {
      amountsAreValid = false;
      blockers.push({
        code: "category_allocation_invalid_amount",
        field: "allocations",
        message: "Category allocations must use positive integer minor units.",
        allocationIndex,
      });
    }

    if (allocation.categoryKind !== expectedKind) {
      blockers.push({
        code: "category_allocation_kind_mismatch",
        field: "allocations",
        message: `Choose an ${expectedKind} category.`,
        allocationIndex,
      });
    }
  });

  if (amountsAreValid) {
    const actualAmountMinor = sumMinorUnits(
      allocations.map((allocation) => allocation.amountMinor),
      "The category allocation total is too large.",
    );

    if (actualAmountMinor !== expectedAmountMinor) {
      blockers.push({
        code: "category_allocation_total_mismatch",
        field: "allocations",
        message: "Category allocations must equal the absolute source amount.",
        expectedAmountMinor,
        actualAmountMinor,
      });
    }
  }

  return blockers;
}

export function getReviewBlockers({
  sourceAmountMinor,
  decision,
  canonicalDuplicate = null,
}: ReviewCompletenessInput): ReviewBlocker[] {
  if (!Number.isSafeInteger(sourceAmountMinor)) {
    throw new DomainError("The source amount must use safe integer minor units.");
  }

  if (decision.disposition === null) {
    return [
      {
        code: "decision_required",
        field: "disposition",
        message: "Accept, exclude, or mark the row as a duplicate.",
      },
    ];
  }

  if (decision.disposition === "excluded") {
    return nonblank(decision.exclusionReason)
      ? []
      : [
          {
            code: "exclusion_reason_required",
            field: "exclusionReason",
            message: "Explain why this source row is excluded.",
          },
        ];
  }

  if (decision.disposition === "duplicate") {
    if (
      decision.duplicateOfRowId === null ||
      canonicalDuplicate === null ||
      canonicalDuplicate.rowId !== decision.duplicateOfRowId
    ) {
      return [
        {
          code: "duplicate_canonical_required",
          field: "duplicateOfRowId",
          message: "Link this duplicate to its canonical source row.",
        },
      ];
    }

    return canonicalDuplicate.disposition === "accepted"
      ? []
      : [
          {
            code: "duplicate_canonical_not_accepted",
            field: "duplicateOfRowId",
            message: "The canonical duplicate row must be accepted.",
          },
        ];
  }

  if (decision.confirmedType === null) {
    return [
      {
        code: "confirmed_type_required",
        field: "confirmedType",
        message: "Confirm the transaction type.",
      },
    ];
  }

  if (
    decision.confirmedType === "income" ||
    decision.confirmedType === "expense" ||
    decision.confirmedType === "refund"
  ) {
    if (sourceAmountMinor === 0) {
      return [
        {
          code: "zero_amount_not_allocatable",
          field: "allocations",
          message:
            "Zero-amount rows cannot use income, expense, or refund categories. Exclude the row or review it as a transfer or adjustment.",
        },
      ];
    }

    const directionIsValid =
      (decision.confirmedType === "expense" && sourceAmountMinor < 0) ||
      (decision.confirmedType !== "expense" && sourceAmountMinor > 0);
    if (!directionIsValid) {
      return [
        {
          code: "transaction_type_amount_direction",
          field: "confirmedType",
          message:
            decision.confirmedType === "expense"
              ? "Expenses must be money leaving the account. Choose the type that matches this positive amount."
              : `${decision.confirmedType === "income" ? "Income" : "Refunds"} must be money entering the account. Choose the type that matches this negative amount.`,
        },
      ];
    }

    const expectedKind = decision.confirmedType === "income" ? "income" : "expense";

    return categoryBlockers(
      decision.allocations,
      expectedKind,
      Math.abs(sourceAmountMinor),
    );
  }

  const blockers: ReviewBlocker[] =
    decision.allocations.length === 0
      ? []
      : [
          {
            code: "category_not_allowed",
            field: "allocations",
            message: `${decision.confirmedType === "transfer" ? "Transfers" : "Adjustments"} do not use income or expense categories.`,
          },
        ];

  if (decision.confirmedType === "adjustment" && !nonblank(decision.note)) {
    blockers.push({
      code: "adjustment_note_required",
      field: "note",
      message: "Explain the evidence supporting this adjustment.",
    });
  }

  return blockers;
}
