import { describe, expect, it } from "vitest";

import {
  calculateDashboardComparison,
  type DashboardReportFacts,
} from "@/domain/dashboard-insights";

function report(overrides: Partial<DashboardReportFacts> = {}): DashboardReportFacts {
  return {
    incomeMinor: 0,
    savingsMinor: 0,
    netWorthMinor: 0,
    debtMinor: 0,
    categories: [],
    manualValues: [],
    ...overrides,
  };
}

describe("dashboard comparisons", () => {
  it("ranks spending, increases, and budget overages deterministically", () => {
    const comparison = calculateDashboardComparison(
      report({
        categories: [
          {
            categoryId: 1,
            categoryName: "Dining",
            actualMinor: 20_000,
            plannedMinor: 15_000,
            sourceCount: 3,
          },
          {
            categoryId: 2,
            categoryName: "Housing",
            actualMinor: 50_000,
            plannedMinor: 50_000,
            sourceCount: 1,
          },
          {
            categoryId: 3,
            categoryName: "Groceries",
            actualMinor: 30_000,
            plannedMinor: 25_000,
            sourceCount: 4,
          },
        ],
      }),
      report({
        categories: [
          {
            categoryId: 1,
            categoryName: "Dining",
            actualMinor: 5_000,
            plannedMinor: null,
            sourceCount: 1,
          },
          {
            categoryId: 2,
            categoryName: "Housing",
            actualMinor: 50_000,
            plannedMinor: null,
            sourceCount: 1,
          },
          {
            categoryId: 3,
            categoryName: "Groceries",
            actualMinor: 20_000,
            plannedMinor: null,
            sourceCount: 2,
          },
        ],
      }),
    );

    expect(comparison.largestSpending.map((category) => category.categoryName)).toEqual(
      ["Housing", "Groceries", "Dining"],
    );
    expect(
      comparison.categoryIncreases.map((category) => [
        category.categoryName,
        category.changeMinor,
      ]),
    ).toEqual([
      ["Dining", 15_000],
      ["Groceries", 10_000],
    ]);
    expect(
      comparison.overBudget.map((category) => [
        category.categoryName,
        category.overByMinor,
      ]),
    ).toEqual([
      ["Groceries", 5_000],
      ["Dining", 5_000],
    ]);
  });

  it("reconciles net-worth change into cash flow, manual values, and a remainder", () => {
    const comparison = calculateDashboardComparison(
      report({
        incomeMinor: 100_000,
        savingsMinor: 40_000,
        netWorthMinor: 590_000,
        debtMinor: 90_000,
        manualValues: [
          { key: "home", amountMinor: 500_000 },
          { key: "vehicle", amountMinor: 80_000 },
        ],
      }),
      report({
        incomeMinor: 90_000,
        netWorthMinor: 500_000,
        debtMinor: 100_000,
        manualValues: [
          { key: "home", amountMinor: 450_000 },
          { key: "vehicle", amountMinor: 75_000 },
        ],
      }),
    );

    expect(comparison).toMatchObject({
      incomeChangeMinor: 10_000,
      debtChangeMinor: -10_000,
      netWorthChangeMinor: 90_000,
      cashFlowContributionMinor: 40_000,
      manualValueContributionMinor: 55_000,
      otherPositionContributionMinor: -5_000,
    });
    expect(
      comparison.cashFlowContributionMinor +
        comparison.manualValueContributionMinor +
        comparison.otherPositionContributionMinor,
    ).toBe(comparison.netWorthChangeMinor);
  });

  it("treats refunds as lower spending rather than a ranked category", () => {
    const comparison = calculateDashboardComparison(
      report({
        categories: [
          {
            categoryId: 1,
            categoryName: "Returns",
            actualMinor: -2_000,
            plannedMinor: 0,
            sourceCount: 1,
          },
        ],
      }),
      report(),
    );

    expect(comparison.largestSpending).toEqual([]);
    expect(comparison.categoryIncreases).toEqual([]);
    expect(comparison.overBudget).toEqual([]);
  });
});
