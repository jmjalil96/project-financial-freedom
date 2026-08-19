import { describe, expect, it } from "vitest";

import {
  evaluateAccountCoverage,
  findCoverageGaps,
  getRequiredCoverageWindow,
  mergeCoverageIntervals,
  type StatementCoverageInterval,
} from "@/domain/coverage";

const account = {
  id: 1,
  name: "Visa",
  type: "credit_card",
  requiredForClose: true,
  openingDate: "2026-07-16",
  archivedOn: null,
};

function statement(
  batchId: number,
  start: string,
  end: string,
  reviewStatus: StatementCoverageInterval["reviewStatus"] = "finalized",
): StatementCoverageInterval {
  return {
    batchId,
    sourceFilename: `statement-${batchId}.csv`,
    start,
    end,
    reviewStatus,
  };
}

describe("statement coverage", () => {
  it("merges overlapping and adjacent intervals without losing source batches", () => {
    expect(
      mergeCoverageIntervals([
        { start: "2026-08-16", end: "2026-09-15", batchId: 2 },
        { start: "2026-07-16", end: "2026-08-15", batchId: 1 },
        { start: "2026-08-10", end: "2026-08-20", batchId: 3 },
      ]),
    ).toEqual([
      {
        start: "2026-07-16",
        end: "2026-09-15",
        batchIds: [1, 3, 2],
      },
    ]);
  });

  it("finds exact gaps after clipping irrelevant statement dates", () => {
    expect(
      findCoverageGaps({ start: "2026-08-01", end: "2026-08-31" }, [
        { start: "2026-07-15", end: "2026-08-10" },
        { start: "2026-08-15", end: "2026-08-20" },
        { start: "2026-08-25", end: "2026-09-15" },
      ]),
    ).toEqual([
      { start: "2026-08-11", end: "2026-08-14" },
      { start: "2026-08-21", end: "2026-08-24" },
    ]);
  });

  it("uses later cross-month statements to complete an irregular August cycle", () => {
    const result = evaluateAccountCoverage({
      account,
      targetMonth: "2026-08",
      statements: [
        statement(1, "2026-07-16", "2026-08-15"),
        statement(2, "2026-08-16", "2026-09-15"),
      ],
    });
    expect(result.requiredWindow).toEqual({
      start: "2026-07-16",
      end: "2026-08-31",
    });
    expect(result.status).toBe("complete");
    expect(result.gaps).toEqual([]);
  });

  it("distinguishes pending evidence, true gaps, optional, and inactive accounts", () => {
    expect(
      evaluateAccountCoverage({
        account,
        targetMonth: "2026-08",
        statements: [
          statement(1, "2026-07-16", "2026-08-15"),
          statement(2, "2026-08-16", "2026-09-15", "in_review"),
        ],
      }).status,
    ).toBe("pending_finalization");
    expect(
      evaluateAccountCoverage({
        account,
        targetMonth: "2026-08",
        statements: [statement(1, "2026-07-16", "2026-08-15")],
      }).status,
    ).toBe("gap");
    expect(
      evaluateAccountCoverage({
        account: { ...account, requiredForClose: false },
        targetMonth: "2026-08",
        statements: [],
      }).status,
    ).toBe("not_required");
    expect(
      evaluateAccountCoverage({
        account: { ...account, openingDate: "2026-09-01" },
        targetMonth: "2026-08",
        statements: [],
      }).status,
    ).toBe("not_applicable");
  });

  it("limits required evidence for mid-month openings, closures, and prior closes", () => {
    expect(
      getRequiredCoverageWindow({
        targetMonth: "2026-08",
        openingDate: "2026-08-12",
        archivedOn: "2026-08-23",
      }),
    ).toEqual({ start: "2026-08-12", end: "2026-08-23" });
    expect(
      getRequiredCoverageWindow({
        targetMonth: "2026-08",
        openingDate: "2026-01-01",
        archivedOn: null,
        priorClosedMonthEnd: "2026-07-31",
      }),
    ).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(() =>
      getRequiredCoverageWindow({
        targetMonth: "2026-08",
        openingDate: "2026-08-20",
        archivedOn: "2026-08-19",
      }),
    ).toThrow("cannot close before it opens");
  });
});
