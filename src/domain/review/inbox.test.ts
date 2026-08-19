import { describe, expect, it } from "vitest";

import { getReviewBlockers, type ReviewDecision } from "@/domain/review/completeness";
import {
  deriveInboxFilters,
  filterInboxRows,
  matchesInboxFilter,
  type InboxRowState,
} from "@/domain/review/inbox";

function decision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    disposition: "accepted",
    confirmedType: "expense",
    allocations: [{ categoryId: 1, categoryKind: "expense", amountMinor: 1_000 }],
    note: null,
    exclusionReason: null,
    duplicateOfRowId: null,
    ...overrides,
  };
}

function row(
  reviewDecision: ReviewDecision,
  overrides: Partial<InboxRowState> = {},
): InboxRowState {
  return {
    warnings: [],
    duplicateCandidates: [],
    transferCandidates: [],
    decision: reviewDecision,
    blockers: getReviewBlockers({
      sourceAmountMinor: -1_000,
      decision: reviewDecision,
    }),
    ...overrides,
  };
}

describe("review inbox filters", () => {
  it("derives unresolved warning and candidate filters from a pending row", () => {
    const pendingDecision = decision({
      disposition: null,
      confirmedType: null,
      allocations: [],
    });

    expect(
      deriveInboxFilters(
        row(pendingDecision, {
          warnings: [
            {
              code: "transaction_date_outside_statement",
              field: "transaction_date",
            },
          ],
          duplicateCandidates: [12],
          transferCandidates: [18],
        }),
      ),
    ).toEqual([
      "unknown_type",
      "suspected_duplicate",
      "possible_transfer",
      "date_uncertainty",
      "reconciliation_blocker",
    ]);
  });

  it("derives category and type predicates from structured blockers", () => {
    const categoryRow = row(
      decision({
        allocations: [],
      }),
    );
    const typeRow = row(
      decision({
        confirmedType: null,
        allocations: [],
      }),
    );

    expect(deriveInboxFilters(categoryRow)).toEqual([
      "needs_category",
      "reconciliation_blocker",
    ]);
    expect(matchesInboxFilter(typeRow, "unknown_type")).toBe(true);
    expect(matchesInboxFilter(typeRow, "needs_category")).toBe(false);
    expect(
      matchesInboxFilter(
        row(decision({ disposition: null, confirmedType: null, allocations: [] }), {
          suggestedType: "expense",
        }),
        "needs_category",
      ),
    ).toBe(true);
  });

  it("surfaces a transfer suggestion even without a matched counterpart", () => {
    const pendingDecision = decision({
      disposition: null,
      confirmedType: null,
      allocations: [],
    });

    expect(
      deriveInboxFilters(row(pendingDecision, { possibleTransfer: true })),
    ).toContain("possible_transfer");
  });

  it("treats resolved candidates and confirmed dates as ready", () => {
    const readyRow = row(decision({ effectiveDateConfirmed: true }), {
      warnings: [
        {
          code: "posted_date_outside_statement",
          field: "posted_date",
        },
      ],
      transferCandidates: [18],
    });

    expect(deriveInboxFilters(readyRow)).toEqual(["ready_to_finalize"]);
  });

  it("keeps accepted rows with open candidates out of ready results", () => {
    expect(
      deriveInboxFilters(
        row(decision({ effectiveDateConfirmed: true }), {
          duplicateCandidates: [12],
        }),
      ),
    ).toEqual(["suspected_duplicate"]);
  });

  it("keeps explicit reconciliation warnings out of ready results", () => {
    expect(
      deriveInboxFilters(
        row(decision(), {
          warnings: [{ code: "reconciliation_balance_uncertain" }],
        }),
      ),
    ).toEqual(["reconciliation_blocker"]);
  });

  it("filters rows with the same predicates used for derivation", () => {
    const readyRow = row(decision());
    const incompleteRow = row(decision({ allocations: [] }));

    expect(filterInboxRows([readyRow, incompleteRow], "ready_to_finalize")).toEqual([
      readyRow,
    ]);
    expect(filterInboxRows([readyRow, incompleteRow], "needs_category")).toEqual([
      incompleteRow,
    ]);
  });
});
