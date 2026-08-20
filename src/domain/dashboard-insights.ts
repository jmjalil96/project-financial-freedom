import { sumMinorUnits } from "@/domain/money";

export type DashboardCategoryFact = {
  categoryId: number;
  categoryName: string;
  actualMinor: number;
  plannedMinor: number | null;
  sourceCount: number;
};

export type DashboardReportFacts = {
  incomeMinor: number;
  savingsMinor: number;
  netWorthMinor: number;
  debtMinor: number;
  categories: DashboardCategoryFact[];
  manualValues: Array<{ key: string; amountMinor: number }>;
};

export type DashboardCategoryIncrease = DashboardCategoryFact & {
  priorActualMinor: number;
  changeMinor: number;
};

export type DashboardBudgetOverage = DashboardCategoryFact & {
  overByMinor: number;
};

export type DashboardComparison = {
  largestSpending: DashboardCategoryFact[];
  categoryIncreases: DashboardCategoryIncrease[];
  overBudget: DashboardBudgetOverage[];
  incomeChangeMinor: number;
  debtChangeMinor: number;
  netWorthChangeMinor: number;
  cashFlowContributionMinor: number;
  manualValueContributionMinor: number;
  otherPositionContributionMinor: number;
};

function difference(left: number, right: number, message: string): number {
  return sumMinorUnits([left, -right], message);
}

function compareAmountsThenNames(
  left: DashboardCategoryFact,
  right: DashboardCategoryFact,
): number {
  return (
    right.actualMinor - left.actualMinor ||
    left.categoryName.localeCompare(right.categoryName)
  );
}

export function calculateDashboardComparison(
  current: DashboardReportFacts,
  prior: DashboardReportFacts,
): DashboardComparison {
  const priorCategories = new Map(
    prior.categories.map((category) => [category.categoryId, category]),
  );
  const largestSpending = current.categories
    .filter((category) => category.actualMinor > 0)
    .sort(compareAmountsThenNames)
    .slice(0, 3);
  const categoryIncreases = current.categories
    .map((category): DashboardCategoryIncrease => {
      const priorActualMinor =
        priorCategories.get(category.categoryId)?.actualMinor ?? 0;
      return {
        ...category,
        priorActualMinor,
        changeMinor: difference(
          category.actualMinor,
          priorActualMinor,
          "The category comparison is too large.",
        ),
      };
    })
    .filter((category) => category.changeMinor > 0 && category.actualMinor > 0)
    .sort(
      (left, right) =>
        right.changeMinor - left.changeMinor || compareAmountsThenNames(left, right),
    )
    .slice(0, 3);
  const overBudget = current.categories
    .flatMap((category): DashboardBudgetOverage[] => {
      if (
        category.plannedMinor === null ||
        category.actualMinor <= category.plannedMinor
      ) {
        return [];
      }
      return [
        {
          ...category,
          overByMinor: difference(
            category.actualMinor,
            category.plannedMinor,
            "The budget overage is too large.",
          ),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.overByMinor - left.overByMinor || compareAmountsThenNames(left, right),
    );
  const manualValueByKey = new Map(
    prior.manualValues.map((value) => [value.key, value.amountMinor]),
  );
  const manualKeys = new Set([
    ...manualValueByKey.keys(),
    ...current.manualValues.map((value) => value.key),
  ]);
  const currentManualValueByKey = new Map(
    current.manualValues.map((value) => [value.key, value.amountMinor]),
  );
  const manualValueContributionMinor = sumMinorUnits(
    [...manualKeys].map((key) =>
      difference(
        currentManualValueByKey.get(key) ?? 0,
        manualValueByKey.get(key) ?? 0,
        "The manual-value comparison is too large.",
      ),
    ),
    "The combined manual-value change is too large.",
  );
  const netWorthChangeMinor = difference(
    current.netWorthMinor,
    prior.netWorthMinor,
    "The net-worth comparison is too large.",
  );
  const otherPositionContributionMinor = sumMinorUnits(
    [netWorthChangeMinor, -current.savingsMinor, -manualValueContributionMinor],
    "The remaining net-worth change is too large.",
  );
  return {
    largestSpending,
    categoryIncreases,
    overBudget,
    incomeChangeMinor: difference(
      current.incomeMinor,
      prior.incomeMinor,
      "The income comparison is too large.",
    ),
    debtChangeMinor: difference(
      current.debtMinor,
      prior.debtMinor,
      "The debt comparison is too large.",
    ),
    netWorthChangeMinor,
    cashFlowContributionMinor: current.savingsMinor,
    manualValueContributionMinor,
    otherPositionContributionMinor,
  };
}
