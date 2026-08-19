import {
  addCalendarDays,
  calendarDateSchema,
  getCalendarMonthBounds,
} from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";

export type CalendarInterval = {
  start: string;
  end: string;
};

export type StatementCoverageInterval = CalendarInterval & {
  batchId: number;
  sourceFilename: string;
  reviewStatus: "pending" | "in_review" | "finalized";
};

export type MergedCoverageInterval = CalendarInterval & {
  batchIds: number[];
};

export type AccountCoverageStatus =
  | "complete"
  | "gap"
  | "pending_finalization"
  | "no_evidence"
  | "not_required"
  | "not_applicable";

export type AccountCoverageResult = {
  account: {
    id: number;
    name: string;
    type: string;
    requiredForClose: boolean;
    openingDate: string;
    archivedOn: string | null;
  };
  targetMonth: string;
  requiredWindow: CalendarInterval | null;
  status: AccountCoverageStatus;
  finalizedCoverage: MergedCoverageInterval[];
  pendingCoverage: MergedCoverageInterval[];
  gaps: CalendarInterval[];
  statements: StatementCoverageInterval[];
};

function compareIntervals(first: CalendarInterval, second: CalendarInterval): number {
  return first.start.localeCompare(second.start) || first.end.localeCompare(second.end);
}

function validateCoverageInterval(
  interval: CalendarInterval,
  label: string,
): CalendarInterval {
  const start = calendarDateSchema.parse(interval.start);
  const end = calendarDateSchema.parse(interval.end);
  if (start > end) {
    throw new DomainError(`${label} cannot end before it starts.`);
  }
  return { start, end };
}

export function mergeCoverageIntervals(
  intervals: readonly (CalendarInterval & { batchId?: number })[],
): MergedCoverageInterval[] {
  const sorted = intervals
    .map((interval) => ({
      ...validateCoverageInterval(interval, "A statement coverage interval"),
      batchId: interval.batchId,
    }))
    .sort(compareIntervals);
  const merged: MergedCoverageInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    const batchIds = interval.batchId === undefined ? [] : [interval.batchId];
    if (!previous || interval.start > addCalendarDays(previous.end, 1)) {
      merged.push({ start: interval.start, end: interval.end, batchIds });
      continue;
    }
    if (interval.end > previous.end) {
      previous.end = interval.end;
    }
    for (const batchId of batchIds) {
      if (!previous.batchIds.includes(batchId)) {
        previous.batchIds.push(batchId);
      }
    }
  }

  return merged;
}

export function findCoverageGaps(
  requiredWindow: CalendarInterval,
  coverage: readonly CalendarInterval[],
): CalendarInterval[] {
  const validatedWindow = validateCoverageInterval(
    requiredWindow,
    "The required coverage window",
  );
  const validatedCoverage = coverage.map((interval) =>
    validateCoverageInterval(interval, "A statement coverage interval"),
  );
  const relevant = mergeCoverageIntervals(
    validatedCoverage
      .filter(
        (interval) =>
          interval.end >= validatedWindow.start &&
          interval.start <= validatedWindow.end,
      )
      .map((interval) => ({
        start:
          interval.start < validatedWindow.start
            ? validatedWindow.start
            : interval.start,
        end: interval.end > validatedWindow.end ? validatedWindow.end : interval.end,
      })),
  );
  const gaps: CalendarInterval[] = [];
  let cursor = validatedWindow.start;

  for (const interval of relevant) {
    if (interval.start > cursor) {
      gaps.push({ start: cursor, end: addCalendarDays(interval.start, -1) });
    }
    const next = addCalendarDays(interval.end, 1);
    if (next > cursor) {
      cursor = next;
    }
  }
  if (cursor <= validatedWindow.end) {
    gaps.push({ start: cursor, end: validatedWindow.end });
  }
  return gaps;
}

export function getRequiredCoverageWindow(input: {
  targetMonth: string;
  openingDate: string;
  archivedOn: string | null;
  priorClosedMonthEnd?: string | null;
}): CalendarInterval | null {
  const month = getCalendarMonthBounds(input.targetMonth);
  const openingDate = calendarDateSchema.parse(input.openingDate);
  const archivedOn = input.archivedOn
    ? calendarDateSchema.parse(input.archivedOn)
    : null;
  const priorClosedMonthEnd = input.priorClosedMonthEnd
    ? calendarDateSchema.parse(input.priorClosedMonthEnd)
    : null;
  if (archivedOn && archivedOn < openingDate) {
    throw new DomainError("An account cannot close before it opens.");
  }
  const startCandidate = priorClosedMonthEnd
    ? addCalendarDays(priorClosedMonthEnd, 1)
    : openingDate;
  const start = startCandidate > openingDate ? startCandidate : openingDate;
  const end = archivedOn && archivedOn < month.end ? archivedOn : month.end;

  if (start > month.end || end < month.start || start > end) {
    return null;
  }
  return { start, end };
}

export function evaluateAccountCoverage(input: {
  account: AccountCoverageResult["account"];
  targetMonth: string;
  statements: readonly StatementCoverageInterval[];
  priorClosedMonthEnd?: string | null;
}): AccountCoverageResult {
  const requiredWindow = getRequiredCoverageWindow({
    targetMonth: input.targetMonth,
    openingDate: input.account.openingDate,
    archivedOn: input.account.archivedOn,
    priorClosedMonthEnd: input.priorClosedMonthEnd,
  });
  const finalizedStatements = input.statements.filter(
    (statement) => statement.reviewStatus === "finalized",
  );
  const pendingStatements = input.statements.filter(
    (statement) => statement.reviewStatus !== "finalized",
  );
  const finalizedCoverage = mergeCoverageIntervals(finalizedStatements);
  const pendingCoverage = mergeCoverageIntervals(pendingStatements);
  const gaps = requiredWindow
    ? findCoverageGaps(requiredWindow, finalizedCoverage)
    : [];

  let status: AccountCoverageStatus;
  if (!input.account.requiredForClose) {
    status = "not_required";
  } else if (!requiredWindow) {
    status = "not_applicable";
  } else if (gaps.length === 0) {
    status = "complete";
  } else {
    const remainingWithPending = findCoverageGaps(requiredWindow, [
      ...finalizedCoverage,
      ...pendingCoverage,
    ]);
    if (remainingWithPending.length === 0 && pendingCoverage.length > 0) {
      status = "pending_finalization";
    } else if (finalizedCoverage.length === 0 && pendingCoverage.length === 0) {
      status = "no_evidence";
    } else {
      status = "gap";
    }
  }

  return {
    account: input.account,
    targetMonth: input.targetMonth,
    requiredWindow,
    status,
    finalizedCoverage,
    pendingCoverage,
    gaps,
    statements: [...input.statements].sort(compareIntervals),
  };
}
