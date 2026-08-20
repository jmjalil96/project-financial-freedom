import type { Metadata } from "next";

import { getLocalCalendarDate, getLocalCalendarMonth } from "@/domain/calendar-date";
import {
  getNetWorthSnapshot,
  listOutsideScopeTransferAssignments,
} from "@/features/net-worth/net-worth-service";
import { NetWorthWorkspace } from "@/features/net-worth/net-worth-workspace";

export const metadata: Metadata = {
  title: "Net worth",
};

export default async function NetWorthPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const requestedMonth = (await searchParams).month;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth ?? "")
    ? requestedMonth!
    : getLocalCalendarMonth();
  const [snapshot, outsideScopeTransfers] = await Promise.all([
    getNetWorthSnapshot(month),
    listOutsideScopeTransferAssignments(),
  ]);
  return (
    <NetWorthWorkspace
      outsideScopeTransfers={outsideScopeTransfers}
      snapshot={snapshot}
      today={getLocalCalendarDate()}
    />
  );
}
