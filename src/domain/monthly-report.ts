import { z } from "zod";

import { isCalendarMonth } from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";

export const calendarMonthSchema = z
  .string()
  .refine(isCalendarMonth, "Enter a valid calendar month.");

export type SavingsMetrics = {
  savingsMinor: number;
  savingsRateBasisPoints: number | null;
};

export function calculateSavingsMetrics(
  incomeMinor: number,
  expensesMinor: number,
): SavingsMetrics {
  if (!Number.isSafeInteger(incomeMinor) || !Number.isSafeInteger(expensesMinor)) {
    throw new DomainError("Monthly report totals must use safe integer minor units.");
  }
  const savingsMinor = incomeMinor - expensesMinor;
  if (!Number.isSafeInteger(savingsMinor)) {
    throw new DomainError("The monthly savings amount is too large.");
  }
  return {
    savingsMinor,
    savingsRateBasisPoints:
      incomeMinor > 0 ? Math.round((savingsMinor / incomeMinor) * 10_000) : null,
  };
}

export type BudgetProgressStatus = "unbudgeted" | "on_track" | "over";

export function calculateBudgetProgress(
  plannedMinor: number | null,
  actualMinor: number,
): {
  remainingMinor: number | null;
  status: BudgetProgressStatus;
} {
  if (
    (plannedMinor !== null &&
      (!Number.isSafeInteger(plannedMinor) || plannedMinor < 0)) ||
    !Number.isSafeInteger(actualMinor)
  ) {
    throw new DomainError("Budget values must use valid integer minor units.");
  }
  if (plannedMinor === null) {
    return { remainingMinor: null, status: "unbudgeted" };
  }
  const remainingMinor = plannedMinor - actualMinor;
  if (!Number.isSafeInteger(remainingMinor)) {
    throw new DomainError("The budget variance is too large.");
  }
  return {
    remainingMinor,
    status: remainingMinor < 0 ? "over" : "on_track",
  };
}

export function formatSavingsRate(basisPoints: number | null): string {
  if (basisPoints === null) {
    return "Not available";
  }
  if (!Number.isSafeInteger(basisPoints)) {
    throw new DomainError("The savings rate is invalid.");
  }
  return `${(basisPoints / 100).toFixed(1)}%`;
}
