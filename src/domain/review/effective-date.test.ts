import { describe, expect, it } from "vitest";

import { deriveDefaultEffectiveDate } from "@/domain/review/effective-date";

describe("deriveDefaultEffectiveDate", () => {
  it("uses transaction dates for credit-card expenses and refunds", () => {
    for (const transactionType of ["expense", "refund"] as const) {
      expect(
        deriveDefaultEffectiveDate({
          accountType: "credit_card",
          transactionType,
          transactionDate: "2026-08-31",
          postedDate: "2026-09-02",
          amountMinor: transactionType === "expense" ? -2_500 : 2_500,
        }),
      ).toBe("2026-08-31");
    }
  });

  it("re-derives a credit-card transfer from the confirmed type", () => {
    expect(
      deriveDefaultEffectiveDate({
        accountType: "credit_card",
        transactionType: "transfer",
        transactionDate: "2026-08-31",
        postedDate: "2026-09-02",
        amountMinor: 10_000,
      }),
    ).toBe("2026-09-02");
  });
});
