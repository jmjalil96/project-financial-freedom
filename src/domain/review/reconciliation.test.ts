import { describe, expect, it } from "vitest";

import { calculateReconciliation } from "@/domain/review/reconciliation";

describe("calculateReconciliation", () => {
  it("uses accepted asset activity while retaining source and provisional totals", () => {
    expect(
      calculateReconciliation({
        openingBalanceMinor: 100_000,
        closingBalanceMinor: 91_755,
        activity: [
          { amountMinor: -8_245, disposition: "accepted" },
          { amountMinor: -1_200, disposition: "excluded" },
          { amountMinor: -8_245, disposition: "duplicate" },
          { amountMinor: 500, disposition: null },
        ],
      }),
    ).toEqual({
      openingBalanceMinor: 100_000,
      closingBalanceMinor: 91_755,
      sourceActivityTotalMinor: -17_190,
      provisionalActivityTotalMinor: -7_745,
      acceptedActivityTotalMinor: -8_245,
      expectedClosingBalanceMinor: 91_755,
      differenceMinor: 0,
    });
  });

  it("uses already-normalized liability signs without account-type conversion", () => {
    expect(
      calculateReconciliation({
        openingBalanceMinor: -40_000,
        closingBalanceMinor: -23_000,
        activity: [
          { amountMinor: -6_000, disposition: "accepted" },
          { amountMinor: 20_000, disposition: "accepted" },
          { amountMinor: 2_000, disposition: "accepted" },
          { amountMinor: -100, disposition: "excluded" },
        ],
      }),
    ).toEqual({
      openingBalanceMinor: -40_000,
      closingBalanceMinor: -23_000,
      sourceActivityTotalMinor: 15_900,
      provisionalActivityTotalMinor: 16_000,
      acceptedActivityTotalMinor: 16_000,
      expectedClosingBalanceMinor: -24_000,
      differenceMinor: 1_000,
    });
  });
});
