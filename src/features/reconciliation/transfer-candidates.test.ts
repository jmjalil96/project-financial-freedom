import { describe, expect, it } from "vitest";

import {
  deriveTransferCandidates,
  getTransferCandidateWindow,
  type TransferCandidateSource,
} from "@/features/reconciliation/transfer-candidates";

describe("transfer candidate sourcing", () => {
  it("bounds source reads to three days around the target date range", () => {
    expect(getTransferCandidateWindow(["2026-08-20", "2026-08-10"])).toEqual({
      startDate: "2026-08-07",
      endDate: "2026-08-23",
    });
  });

  it("still derives equal-and-opposite cross-account hints within the window", () => {
    const rows: TransferCandidateSource[] = [
      {
        id: 1,
        accountId: 10,
        accountName: "Checking",
        currency: "USD",
        amountMinor: -10_000,
        transactionDate: "2026-08-20",
        description: "Transfer out",
        suggestedType: "transfer",
        confirmedType: null,
      },
      {
        id: 2,
        accountId: 11,
        accountName: "Savings",
        currency: "USD",
        amountMinor: 10_000,
        transactionDate: "2026-08-22",
        description: "Transfer in",
        suggestedType: null,
        confirmedType: null,
      },
    ];

    expect(deriveTransferCandidates(rows).get(1)).toEqual([
      expect.objectContaining({
        candidateImportRowId: 2,
        daysApart: 2,
      }),
    ]);
  });
});
