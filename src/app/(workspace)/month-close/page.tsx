import type { Metadata } from "next";

import { getLocalCalendarMonth, isCalendarMonth } from "@/domain/calendar-date";
import { getMonthCloseWorkspace } from "@/features/month-close/month-close-service";
import { MonthCloseWorkspace } from "@/features/month-close/month-close-workspace";

export const metadata: Metadata = {
  title: "Monthly close",
};

export default async function MonthClosePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; revision?: string }>;
}) {
  const params = await searchParams;
  const targetMonth = isCalendarMonth(params.month ?? "")
    ? params.month!
    : getLocalCalendarMonth();
  const parsedRevision = Number(params.revision);
  const revisionId =
    Number.isSafeInteger(parsedRevision) && parsedRevision > 0
      ? parsedRevision
      : undefined;
  const workspace = await getMonthCloseWorkspace(targetMonth, revisionId);
  return <MonthCloseWorkspace workspace={workspace} />;
}
