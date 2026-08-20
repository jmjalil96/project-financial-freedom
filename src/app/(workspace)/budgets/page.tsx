import type { Metadata } from "next";

import { getLocalCalendarMonth, isCalendarMonth } from "@/domain/calendar-date";
import { getBudgetMonth } from "@/features/budgets/budget-service";
import { BudgetWorkspace } from "@/features/budgets/budget-workspace";

export const metadata: Metadata = {
  title: "Budgets",
};

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const requestedMonth = (await searchParams).month;
  const targetMonth = isCalendarMonth(requestedMonth ?? "")
    ? requestedMonth!
    : getLocalCalendarMonth();
  const budget = await getBudgetMonth(targetMonth);
  return <BudgetWorkspace budget={budget} />;
}
