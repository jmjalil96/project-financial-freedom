import { and, asc, eq, gte } from "drizzle-orm";

import { monthCloseStates } from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { calendarDateSchema } from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";
import { calendarMonthSchema } from "@/domain/monthly-report";

type LockDatabase = AppDatabase | AppTransaction;

export function assertCalendarMonthOpenInDatabase(
  database: LockDatabase,
  targetMonthInput: string,
  action: string,
): void {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const state = database
    .select({ status: monthCloseStates.status })
    .from(monthCloseStates)
    .where(eq(monthCloseStates.targetMonth, targetMonth))
    .get();
  if (state?.status === "closed") {
    throw new DomainError(
      `${targetMonth} is closed. Reopen the month before ${action}.`,
    );
  }
}

export function assertCalendarDateOpenInDatabase(
  database: LockDatabase,
  calendarDateInput: string,
  action: string,
): void {
  const calendarDate = calendarDateSchema.parse(calendarDateInput);
  assertCalendarMonthOpenInDatabase(database, calendarDate.slice(0, 7), action);
}

export function assertLifecycleChangeOpenInDatabase(
  database: LockDatabase,
  effectiveDateInput: string,
  action: string,
): void {
  const effectiveDate = calendarDateSchema.parse(effectiveDateInput);
  const firstAffectedMonth = effectiveDate.slice(0, 7);
  const closed = database
    .select({ targetMonth: monthCloseStates.targetMonth })
    .from(monthCloseStates)
    .where(
      and(
        eq(monthCloseStates.status, "closed"),
        gte(monthCloseStates.targetMonth, firstAffectedMonth),
      ),
    )
    .orderBy(asc(monthCloseStates.targetMonth))
    .get();
  if (closed) {
    throw new DomainError(
      `${closed.targetMonth} is closed and would be affected. Reopen it before ${action}.`,
    );
  }
}
