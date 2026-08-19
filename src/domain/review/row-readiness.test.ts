import { describe, expect, it } from "vitest";

import type { ReviewDecision } from "@/domain/review/completeness";
import {
  getRowReviewBlockers,
  getStatementBatchBlockers,
} from "@/domain/review/row-readiness";

const completeDecision: ReviewDecision = {
  disposition: "accepted",
  confirmedType: "expense",
  allocations: [{ categoryId: 1, categoryKind: "expense", amountMinor: 1_000 }],
  note: null,
  exclusionReason: null,
  duplicateOfRowId: null,
};

describe("row review readiness", () => {
  it("uses the same effective-date and category blockers for every read path", () => {
    const blockers = getRowReviewBlockers({
      sourceAmountMinor: -1_000,
      decision: completeDecision,
      effectiveDate: null,
      accountOpeningDate: "2026-07-01",
      categories: [
        {
          id: 1,
          name: "Archived expense",
          archivedAt: "2026-08-19T12:00:00.000Z",
        },
      ],
    });

    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "effective_date_required",
      "category_inactive",
    ]);
  });

  it("rejects effective dates before opening and preserves finalized history", () => {
    expect(
      getRowReviewBlockers({
        sourceAmountMinor: -1_000,
        decision: completeDecision,
        effectiveDate: "2026-06-30",
        accountOpeningDate: "2026-07-01",
        categories: [{ id: 1, name: "Archived", archivedAt: "2026-08-19" }],
        batchFinalized: true,
      }).map((blocker) => blocker.code),
    ).toEqual(["effective_date_before_opening"]);
  });

  it("derives statement blockers from the same row state", () => {
    const blockers = getStatementBatchBlockers(
      [
        {
          id: 9,
          blockers: [],
          duplicateCandidates: [{ id: 4, status: "open" }],
        },
      ],
      {
        openingBalanceMinor: 1_000,
        closingBalanceMinor: 900,
        sourceActivityTotalMinor: -100,
        provisionalActivityTotalMinor: -100,
        acceptedActivityTotalMinor: -100,
        expectedClosingBalanceMinor: 900,
        differenceMinor: 0,
      },
    );

    expect(blockers).toEqual([
      expect.objectContaining({
        code: "open_duplicate_candidates",
        candidateIds: [4],
      }),
    ]);
  });
});
