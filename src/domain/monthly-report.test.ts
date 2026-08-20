import { describe, expect, it } from "vitest";

import {
  calculateBudgetProgress,
  calculateSavingsMetrics,
  calendarMonthSchema,
  formatSavingsRate,
} from "@/domain/monthly-report";

describe("monthly report rules", () => {
  it("calculates savings and a basis-point rate from net category activity", () => {
    expect(calculateSavingsMetrics(500_00, 325_00)).toEqual({
      savingsMinor: 175_00,
      savingsRateBasisPoints: 3_500,
    });
    expect(calculateSavingsMetrics(0, 100_00)).toEqual({
      savingsMinor: -100_00,
      savingsRateBasisPoints: null,
    });
    expect(formatSavingsRate(3_333)).toBe("33.3%");
  });

  it("keeps missing budgets distinct from explicit zero targets", () => {
    expect(calculateBudgetProgress(null, 0)).toEqual({
      remainingMinor: null,
      status: "unbudgeted",
    });
    expect(calculateBudgetProgress(0, 1)).toEqual({
      remainingMinor: -1,
      status: "over",
    });
    expect(calculateBudgetProgress(10_000, 8_000)).toEqual({
      remainingMinor: 2_000,
      status: "on_track",
    });
  });

  it("accepts exact calendar months only", () => {
    expect(calendarMonthSchema.parse("2026-08")).toBe("2026-08");
    expect(calendarMonthSchema.safeParse("2026-13").success).toBe(false);
    expect(calendarMonthSchema.safeParse("August").success).toBe(false);
  });
});
