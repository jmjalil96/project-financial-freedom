import type { Metadata } from "next";

import { getLocalCalendarMonth } from "@/domain/calendar-date";
import { CoverageWorkspace } from "@/features/coverage/coverage-workspace";
import { getMonthCoverage } from "@/features/coverage/coverage-service";

export const metadata: Metadata = {
  title: "Statement coverage",
};

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const requestedMonth = (await searchParams).month;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth ?? "")
    ? requestedMonth!
    : getLocalCalendarMonth();
  const summary = await getMonthCoverage(month);

  return <CoverageWorkspace summary={summary} />;
}
