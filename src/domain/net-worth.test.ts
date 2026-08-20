import { describe, expect, it } from "vitest";

import {
  isValuationStale,
  normalizeManualItemName,
  shiftCalendarMonth,
  toNaturalManualValue,
  toSignedManualValue,
} from "@/domain/net-worth";

describe("manual valuation and net-worth rules", () => {
  it("normalizes manual identities and preserves liability display semantics", () => {
    expect(normalizeManualItemName("  My\u00a0  HOME  ")).toBe("my home");
    expect(toSignedManualValue("asset", 250_000)).toBe(250_000);
    expect(toSignedManualValue("liability", 250_000)).toBe(-250_000);
    expect(toNaturalManualValue("liability", -250_000)).toBe(250_000);
    expect(() => toSignedManualValue("asset", -1)).toThrow("nonnegative");
  });

  it.each([
    { frequency: "monthly" as const, valuationDate: "2026-08-01", stale: false },
    { frequency: "monthly" as const, valuationDate: "2026-07-31", stale: true },
    { frequency: "quarterly" as const, valuationDate: "2026-06-01", stale: false },
    { frequency: "quarterly" as const, valuationDate: "2026-05-31", stale: true },
    { frequency: "annual" as const, valuationDate: "2025-09-01", stale: false },
    { frequency: "annual" as const, valuationDate: "2025-08-31", stale: true },
    { frequency: "ad_hoc" as const, valuationDate: "2020-01-01", stale: false },
  ])(
    "applies $frequency freshness to $valuationDate",
    ({ frequency, valuationDate, stale }) => {
      expect(
        isValuationStale({
          frequency,
          valuationDate,
          monthEnd: "2026-08-31",
        }),
      ).toBe(stale);
    },
  );

  it("moves across calendar years without timezone arithmetic", () => {
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 2)).toBe("2027-02");
  });
});
