import { describe, expect, it } from "vitest";

import { getReviewBlockers, type ReviewDecision } from "@/domain/review/completeness";

function decision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    disposition: "accepted",
    confirmedType: null,
    allocations: [],
    note: null,
    exclusionReason: null,
    duplicateOfRowId: null,
    ...overrides,
  };
}

describe("getReviewBlockers", () => {
  it.each([
    {
      name: "income",
      sourceAmountMinor: 50_000,
      value: decision({
        confirmedType: "income",
        allocations: [{ categoryId: 1, categoryKind: "income", amountMinor: 50_000 }],
      }),
    },
    {
      name: "split expense",
      sourceAmountMinor: -12_000,
      value: decision({
        confirmedType: "expense",
        allocations: [
          { categoryId: 2, categoryKind: "expense", amountMinor: 9_000 },
          { categoryId: 3, categoryKind: "expense", amountMinor: 3_000 },
        ],
      }),
    },
    {
      name: "split refund",
      sourceAmountMinor: 2_500,
      value: decision({
        confirmedType: "refund",
        allocations: [
          { categoryId: 2, categoryKind: "expense", amountMinor: 1_000 },
          { categoryId: 3, categoryKind: "expense", amountMinor: 1_500 },
        ],
      }),
    },
    {
      name: "transfer",
      sourceAmountMinor: -30_000,
      value: decision({ confirmedType: "transfer" }),
    },
    {
      name: "documented adjustment",
      sourceAmountMinor: 500,
      value: decision({
        confirmedType: "adjustment",
        note: "Statement confirms a correction.",
      }),
    },
  ])("accepts a complete $name decision", ({ sourceAmountMinor, value }) => {
    expect(getReviewBlockers({ sourceAmountMinor, decision: value })).toEqual([]);
  });

  it("returns allocation kind and absolute-total blockers for categories", () => {
    const blockers = getReviewBlockers({
      sourceAmountMinor: -12_000,
      decision: decision({
        confirmedType: "expense",
        allocations: [
          { categoryId: 1, categoryKind: "income", amountMinor: 9_000 },
          { categoryId: 2, categoryKind: "expense", amountMinor: 2_000 },
        ],
      }),
    });

    expect(blockers).toEqual([
      expect.objectContaining({
        code: "category_allocation_kind_mismatch",
        allocationIndex: 0,
      }),
      expect.objectContaining({
        code: "category_allocation_total_mismatch",
        expectedAmountMinor: 12_000,
        actualAmountMinor: 11_000,
      }),
    ]);
  });

  it("validates category identifiers, positive minor units, and unique splits", () => {
    const blockers = getReviewBlockers({
      sourceAmountMinor: 2_500,
      decision: decision({
        confirmedType: "refund",
        allocations: [
          { categoryId: 2, categoryKind: "expense", amountMinor: 2_500 },
          { categoryId: 2, categoryKind: "expense", amountMinor: 0 },
          { categoryId: 0, categoryKind: "expense", amountMinor: 1 },
        ],
      }),
    });

    expect(blockers.map((blocker) => blocker.code)).toEqual([
      "category_allocation_duplicate",
      "category_allocation_invalid_amount",
      "category_allocation_invalid_category",
    ]);
  });

  it("requires no category for transfers and a nonblank adjustment note", () => {
    expect(
      getReviewBlockers({
        sourceAmountMinor: -1_000,
        decision: decision({
          confirmedType: "transfer",
          allocations: [{ categoryId: 2, categoryKind: "expense", amountMinor: 1_000 }],
        }),
      }).map((blocker) => blocker.code),
    ).toEqual(["category_not_allowed"]);

    expect(
      getReviewBlockers({
        sourceAmountMinor: 100,
        decision: decision({ confirmedType: "adjustment", note: " \n " }),
      }).map((blocker) => blocker.code),
    ).toEqual(["adjustment_note_required"]);
  });

  it("blocks category-bearing types for legacy zero-amount rows", () => {
    expect(
      getReviewBlockers({
        sourceAmountMinor: 0,
        decision: decision({
          confirmedType: "expense",
          allocations: [],
        }),
      }),
    ).toEqual([
      expect.objectContaining({
        code: "zero_amount_not_allocatable",
        field: "allocations",
      }),
    ]);
  });

  it.each([
    { confirmedType: "expense" as const, sourceAmountMinor: 100 },
    { confirmedType: "income" as const, sourceAmountMinor: -100 },
    { confirmedType: "refund" as const, sourceAmountMinor: -100 },
  ])(
    "requires $confirmedType to match the source amount direction",
    ({ confirmedType, sourceAmountMinor }) => {
      expect(
        getReviewBlockers({
          sourceAmountMinor,
          decision: decision({
            confirmedType,
            allocations: [
              {
                categoryId: 1,
                categoryKind: confirmedType === "income" ? "income" : "expense",
                amountMinor: 100,
              },
            ],
          }),
        }),
      ).toEqual([
        expect.objectContaining({
          code: "transaction_type_amount_direction",
          field: "confirmedType",
        }),
      ]);
    },
  );

  it("requires excluded reasons and an accepted canonical duplicate", () => {
    expect(
      getReviewBlockers({
        sourceAmountMinor: -100,
        decision: decision({
          disposition: "excluded",
          exclusionReason: " ",
        }),
      }).map((blocker) => blocker.code),
    ).toEqual(["exclusion_reason_required"]);
    expect(
      getReviewBlockers({
        sourceAmountMinor: -100,
        decision: decision({
          disposition: "excluded",
          exclusionReason: "Statement total, not a transaction.",
        }),
      }),
    ).toEqual([]);

    const duplicateDecision = decision({
      disposition: "duplicate",
      duplicateOfRowId: 42,
    });
    expect(
      getReviewBlockers({
        sourceAmountMinor: -100,
        decision: duplicateDecision,
      }).map((blocker) => blocker.code),
    ).toEqual(["duplicate_canonical_required"]);
    expect(
      getReviewBlockers({
        sourceAmountMinor: -100,
        decision: duplicateDecision,
        canonicalDuplicate: { rowId: 42, disposition: "duplicate" },
      }).map((blocker) => blocker.code),
    ).toEqual(["duplicate_canonical_not_accepted"]);
    expect(
      getReviewBlockers({
        sourceAmountMinor: -100,
        decision: duplicateDecision,
        canonicalDuplicate: { rowId: 42, disposition: "accepted" },
      }),
    ).toEqual([]);
  });

  it("returns structured decision and type blockers", () => {
    expect(
      getReviewBlockers({
        sourceAmountMinor: 100,
        decision: decision({ disposition: null }),
      }),
    ).toEqual([
      expect.objectContaining({
        code: "decision_required",
        field: "disposition",
        message: expect.any(String),
      }),
    ]);
    expect(
      getReviewBlockers({
        sourceAmountMinor: 100,
        decision: decision(),
      }),
    ).toEqual([
      expect.objectContaining({
        code: "confirmed_type_required",
        field: "confirmedType",
        message: expect.any(String),
      }),
    ]);
  });
});
