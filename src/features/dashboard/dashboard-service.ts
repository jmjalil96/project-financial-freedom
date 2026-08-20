import { and, asc, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  financialAccounts,
  importBatches,
  importDuplicateCandidates,
  importRowDecisions,
  importRowJournalEntries,
  importRows,
  importTransferResolutions,
  journalEntries,
  ledgerAccounts,
  monthCloseStates,
  postings,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import {
  calendarDateSchema,
  getCalendarMonthBounds,
  getLocalCalendarDate,
} from "@/domain/calendar-date";
import {
  calculateDashboardComparison,
  type DashboardComparison,
  type DashboardReportFacts,
} from "@/domain/dashboard-insights";
import { sumMinorUnits } from "@/domain/money";
import { shiftCalendarMonth } from "@/domain/net-worth";
import {
  getMonthCloseWorkspaceInDatabase,
  type MonthCloseWorkspaceView,
} from "@/features/month-close/month-close-service";
import { loadReviewRowsInDatabase } from "@/features/reconciliation/review-row-loader";
import type {
  MonthlyReport,
  ReportSource,
} from "@/features/reports/monthly-report-service";

type DashboardDatabase = AppDatabase | AppTransaction;

export type DashboardTaskStatus = "complete" | "attention" | "waiting";

export type DashboardTask = {
  id:
    | "accounts"
    | "imports"
    | "review"
    | "transfers"
    | "valuations"
    | "budget"
    | "coverage"
    | "close";
  label: string;
  detail: string;
  href: string;
  status: DashboardTaskStatus;
  count: number;
};

export type NewMerchantFact = {
  name: string;
  amountMinor: number;
  transactionCount: number;
};

export type RepeatedDescriptionFact = {
  description: string;
  currentAmountMinor: number;
  monthCount: number;
  occurrenceCount: number;
};

export type DashboardWorkspace = {
  currentMonth: string;
  lastClosed: {
    targetMonth: string;
    revisionNumber: number;
    closedAt: string;
  } | null;
  focusMonth: string;
  focusState: "closed" | "provisional";
  focusReport: MonthlyReport;
  comparisonMonth: string;
  comparisonHasEvidence: boolean;
  comparison: DashboardComparison;
  currentState: MonthCloseWorkspaceView["state"];
  currentReport: MonthlyReport;
  currentReadiness: MonthCloseWorkspaceView["readiness"];
  tasks: DashboardTask[];
  attentionCount: number;
  newMerchants: NewMerchantFact[];
  repeatedDescriptions: RepeatedDescriptionFact[];
  staleValuations: Array<{
    id: number;
    name: string;
    valuationDate: string | null;
  }>;
  activeAccountCount: number;
};

function reportFacts(report: MonthlyReport): DashboardReportFacts {
  return {
    incomeMinor: report.incomeMinor,
    savingsMinor: report.savingsMinor,
    netWorthMinor: report.netWorth.netWorthMinor,
    debtMinor: report.netWorth.debtMinor,
    categories: report.expenseCategories.map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      actualMinor: category.actualMinor,
      plannedMinor: category.plannedMinor,
      sourceCount: category.sources.length,
    })),
    manualValues: report.netWorth.components.flatMap((component) =>
      component.source.type === "manual_valuation"
        ? [{ key: component.key, amountMinor: component.amountMinor }]
        : [],
    ),
  };
}

function normalizedLabel(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function sourceMerchant(source: ReportSource): string | null {
  return source.importSource?.merchant?.trim() || null;
}

function getNewMerchants(
  database: DashboardDatabase,
  report: MonthlyReport,
): NewMerchantFact[] {
  const priorMerchantRows = database
    .select({
      sourceMerchant: importRows.merchant,
      normalizedMerchant: importRowDecisions.normalizedMerchant,
    })
    .from(importRowJournalEntries)
    .innerJoin(importRows, eq(importRows.id, importRowJournalEntries.importRowId))
    .leftJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
    .innerJoin(
      journalEntries,
      eq(journalEntries.id, importRowJournalEntries.journalEntryId),
    )
    .innerJoin(postings, eq(postings.journalEntryId, journalEntries.id))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(
      and(
        eq(journalEntries.isPosted, true),
        eq(ledgerAccounts.kind, "expense"),
        lt(journalEntries.effectiveDate, report.monthStart),
      ),
    )
    .all();
  const priorNames = new Set(
    priorMerchantRows.flatMap((row) => {
      const merchant = row.normalizedMerchant?.trim() || row.sourceMerchant?.trim();
      return merchant ? [normalizedLabel(merchant)] : [];
    }),
  );
  const byName = new Map<
    string,
    { name: string; amounts: number[]; entryIds: Set<number> }
  >();
  for (const source of report.expenseSources) {
    const merchant = sourceMerchant(source);
    if (!merchant || priorNames.has(normalizedLabel(merchant))) {
      continue;
    }
    const key = normalizedLabel(merchant);
    const existing = byName.get(key) ?? {
      name: merchant,
      amounts: [],
      entryIds: new Set<number>(),
    };
    existing.amounts.push(source.amountMinor);
    existing.entryIds.add(source.journalEntryId);
    byName.set(key, existing);
  }
  return [...byName.values()]
    .map((merchant) => ({
      name: merchant.name,
      amountMinor: sumMinorUnits(
        merchant.amounts,
        "The new-merchant spending total is too large.",
      ),
      transactionCount: merchant.entryIds.size,
    }))
    .sort(
      (left, right) =>
        right.amountMinor - left.amountMinor || left.name.localeCompare(right.name),
    )
    .slice(0, 3);
}

function getRepeatedDescriptions(
  database: DashboardDatabase,
  report: MonthlyReport,
): RepeatedDescriptionFact[] {
  const historyStart = getCalendarMonthBounds(
    shiftCalendarMonth(report.targetMonth, -5),
  ).start;
  const conditions = [
    eq(journalEntries.isPosted, true),
    eq(ledgerAccounts.kind, "expense"),
    gte(journalEntries.effectiveDate, historyStart),
    lte(journalEntries.effectiveDate, report.monthEnd),
  ];
  if (report.ledgerCutoffEntryId !== null) {
    conditions.push(lte(journalEntries.id, report.ledgerCutoffEntryId));
  }
  const rows = database
    .select({
      journalEntryId: journalEntries.id,
      effectiveDate: journalEntries.effectiveDate,
      description: journalEntries.description,
      amountMinor: postings.amountMinor,
    })
    .from(postings)
    .innerJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(and(...conditions))
    .orderBy(asc(journalEntries.effectiveDate), asc(journalEntries.id))
    .all();
  const groups = new Map<
    string,
    {
      description: string;
      months: Set<string>;
      entryIds: Set<number>;
      currentAmounts: number[];
    }
  >();
  for (const row of rows) {
    const key = normalizedLabel(row.description);
    const existing = groups.get(key) ?? {
      description: row.description,
      months: new Set<string>(),
      entryIds: new Set<number>(),
      currentAmounts: [],
    };
    existing.months.add(row.effectiveDate.slice(0, 7));
    existing.entryIds.add(row.journalEntryId);
    if (row.effectiveDate.slice(0, 7) === report.targetMonth) {
      existing.currentAmounts.push(Number(row.amountMinor));
    }
    groups.set(key, existing);
  }
  return [...groups.values()]
    .filter(
      (group) =>
        group.months.size >= 2 &&
        group.months.has(report.targetMonth) &&
        group.currentAmounts.length > 0,
    )
    .map((group) => ({
      description: group.description,
      currentAmountMinor: sumMinorUnits(
        group.currentAmounts,
        "The repeated-description spending total is too large.",
      ),
      monthCount: group.months.size,
      occurrenceCount: group.entryIds.size,
    }))
    .sort(
      (left, right) =>
        right.monthCount - left.monthCount ||
        right.currentAmountMinor - left.currentAmountMinor ||
        left.description.localeCompare(right.description),
    )
    .slice(0, 3);
}

function buildTasks(input: {
  activeAccountCount: number;
  current: MonthCloseWorkspaceView;
  pendingStatementCount: number;
  incompleteReviewCount: number;
  openDuplicateCount: number;
  unresolvedTransferCount: number;
}): DashboardTask[] {
  if (input.activeAccountCount === 0) {
    return [
      {
        id: "accounts",
        label: "Establish your opening position",
        detail: "Add the first tracked account before beginning a monthly review.",
        href: "/accounts",
        status: "attention",
        count: 1,
      },
    ];
  }
  const requiredCoverageGaps = input.current.readiness.coverage.accounts.filter(
    (account) =>
      account.account.requiredForClose &&
      account.status !== "complete" &&
      account.status !== "not_applicable",
  ).length;
  const valuationCount =
    input.current.report.netWorth.missingValuationCount +
    input.current.report.netWorth.staleValuationCount;
  const overBudgetCount = input.current.report.expenseCategories.filter(
    (category) => category.status === "over",
  ).length;
  const closeBlockers = input.current.readiness.blockers.filter(
    (blocker) => blocker.code !== "month_not_ended",
  );
  const waitingForMonthEnd = input.current.readiness.blockers.some(
    (blocker) => blocker.code === "month_not_ended",
  );
  return [
    {
      id: "imports",
      label: "Finalize statement imports",
      detail:
        input.pendingStatementCount > 0
          ? `${input.pendingStatementCount} imported ${input.pendingStatementCount === 1 ? "statement is" : "statements are"} not finalized.`
          : "No imported statements are awaiting finalization.",
      href: "/imports",
      status: input.pendingStatementCount > 0 ? "attention" : "complete",
      count: input.pendingStatementCount,
    },
    {
      id: "review",
      label: "Resolve transaction decisions",
      detail:
        input.incompleteReviewCount + input.openDuplicateCount > 0
          ? `${input.incompleteReviewCount} incomplete ${input.incompleteReviewCount === 1 ? "row" : "rows"} and ${input.openDuplicateCount} open duplicate ${input.openDuplicateCount === 1 ? "candidate" : "candidates"}.`
          : "Transaction and duplicate decisions are complete.",
      href: "/review",
      status:
        input.incompleteReviewCount + input.openDuplicateCount > 0
          ? "attention"
          : "complete",
      count: input.incompleteReviewCount + input.openDuplicateCount,
    },
    {
      id: "transfers",
      label: "Explain owned-account movements",
      detail:
        input.unresolvedTransferCount > 0
          ? `${input.unresolvedTransferCount} accepted ${input.unresolvedTransferCount === 1 ? "transfer needs" : "transfers need"} a match or explicit classification.`
          : "Every accepted transfer has an explanation.",
      href: "/transfers",
      status: input.unresolvedTransferCount > 0 ? "attention" : "complete",
      count: input.unresolvedTransferCount,
    },
    {
      id: "valuations",
      label: "Refresh manual values",
      detail:
        valuationCount > 0
          ? `${valuationCount} applicable manual ${valuationCount === 1 ? "item needs" : "items need"} current or carried evidence.`
          : "Applicable manual values have usable evidence.",
      href: `/net-worth?month=${input.current.targetMonth}`,
      status: valuationCount > 0 ? "attention" : "complete",
      count: valuationCount,
    },
    {
      id: "budget",
      label: "Inspect current budget",
      detail:
        overBudgetCount > 0
          ? `${overBudgetCount} ${overBudgetCount === 1 ? "category is" : "categories are"} over target.`
          : input.current.report.missingBudgetCount > 0
            ? `${input.current.report.missingBudgetCount} active ${input.current.report.missingBudgetCount === 1 ? "category has" : "categories have"} no optional target.`
            : "Every category with a target is on track.",
      href: `/budgets?month=${input.current.targetMonth}`,
      status:
        overBudgetCount > 0
          ? "attention"
          : input.current.report.missingBudgetCount > 0
            ? "waiting"
            : "complete",
      count: overBudgetCount,
    },
    {
      id: "coverage",
      label: "Prove account coverage",
      detail:
        requiredCoverageGaps > 0
          ? `${requiredCoverageGaps} required ${requiredCoverageGaps === 1 ? "account is" : "accounts are"} incomplete through month-end.`
          : "Required accounts have complete finalized coverage.",
      href: `/coverage?month=${input.current.targetMonth}`,
      status: requiredCoverageGaps > 0 ? "attention" : "complete",
      count: requiredCoverageGaps,
    },
    {
      id: "close",
      label: input.current.readiness.isReady ? "Close the month" : "Prepare the close",
      detail: input.current.readiness.isReady
        ? "Every blocking gate passes; the report is ready for confirmation."
        : closeBlockers.length > 0
          ? `${closeBlockers.length} actionable close ${closeBlockers.length === 1 ? "blocker remains" : "blockers remain"}.`
          : waitingForMonthEnd
            ? "The known evidence is clear; the calendar month is still in progress."
            : "Review the closing evidence and acknowledgments.",
      href: `/month-close?month=${input.current.targetMonth}`,
      status: input.current.readiness.isReady
        ? "attention"
        : closeBlockers.length > 0
          ? "attention"
          : "waiting",
      count: closeBlockers.length,
    },
  ];
}

export function getDashboardWorkspaceInDatabase(
  database: DashboardDatabase,
  todayInput = getLocalCalendarDate(),
): DashboardWorkspace {
  const today = calendarDateSchema.parse(todayInput);
  const currentMonth = today.slice(0, 7);
  const latestClosedState = database
    .select({ targetMonth: monthCloseStates.targetMonth })
    .from(monthCloseStates)
    .where(eq(monthCloseStates.status, "closed"))
    .orderBy(sql`${monthCloseStates.targetMonth} DESC`)
    .get();
  const current = getMonthCloseWorkspaceInDatabase(
    database,
    currentMonth,
    undefined,
    today,
  );
  const focusMonth = latestClosedState?.targetMonth ?? currentMonth;
  const focus =
    focusMonth === currentMonth
      ? current
      : getMonthCloseWorkspaceInDatabase(database, focusMonth, undefined, today);
  const comparisonMonth = shiftCalendarMonth(focusMonth, -1);
  const prior = getMonthCloseWorkspaceInDatabase(
    database,
    comparisonMonth,
    undefined,
    today,
  );
  const comparison = calculateDashboardComparison(
    reportFacts(focus.report),
    reportFacts(prior.report),
  );
  const reviewRows = loadReviewRowsInDatabase(database, { nonFinalizedOnly: true });
  const pendingStatementCount = database
    .select({ count: sql<number>`count(*)` })
    .from(importBatches)
    .where(ne(importBatches.reviewStatus, "finalized"))
    .get()?.count;
  const openDuplicateCount = database
    .select({ count: sql<number>`count(*)` })
    .from(importDuplicateCandidates)
    .where(eq(importDuplicateCandidates.status, "open"))
    .get()?.count;
  const unresolvedTransferCount = database
    .select({ count: sql<number>`count(*)` })
    .from(importRowDecisions)
    .leftJoin(
      importTransferResolutions,
      eq(importTransferResolutions.importRowId, importRowDecisions.importRowId),
    )
    .where(
      and(
        eq(importRowDecisions.disposition, "accepted"),
        eq(importRowDecisions.confirmedType, "transfer"),
        isNull(importTransferResolutions.id),
      ),
    )
    .get()?.count;
  const activeAccountCount = database
    .select({ count: sql<number>`count(*)` })
    .from(financialAccounts)
    .where(isNull(financialAccounts.archivedAt))
    .get()?.count;
  const tasks = buildTasks({
    activeAccountCount: Number(activeAccountCount ?? 0),
    current,
    pendingStatementCount: Number(pendingStatementCount ?? 0),
    incompleteReviewCount: reviewRows.filter((row) => row.blockers.length > 0).length,
    openDuplicateCount: Number(openDuplicateCount ?? 0),
    unresolvedTransferCount: Number(unresolvedTransferCount ?? 0),
  });
  const selectedRevision = focus.selectedRevision;
  const comparisonHasEvidence =
    prior.report.incomeSources.length > 0 ||
    prior.report.expenseSources.length > 0 ||
    prior.report.netWorth.components.length > 0 ||
    prior.report.budgetPlannedMinor !== 0;
  return {
    currentMonth,
    lastClosed:
      latestClosedState && selectedRevision
        ? {
            targetMonth: latestClosedState.targetMonth,
            revisionNumber: selectedRevision.revisionNumber,
            closedAt: selectedRevision.closedAt,
          }
        : null,
    focusMonth,
    focusState: latestClosedState ? "closed" : "provisional",
    focusReport: focus.report,
    comparisonMonth,
    comparisonHasEvidence,
    comparison,
    currentState: current.state,
    currentReport: current.report,
    currentReadiness: current.readiness,
    tasks,
    attentionCount: tasks.filter((task) => task.status === "attention").length,
    newMerchants: getNewMerchants(database, focus.report),
    repeatedDescriptions: getRepeatedDescriptions(database, focus.report),
    staleValuations: current.report.netWorth.manualItems
      .filter((item) => item.isApplicable && (item.isStale || !item.latestValuation))
      .map((item) => ({
        id: item.id,
        name: item.name,
        valuationDate: item.latestValuation?.effectiveDate ?? null,
      })),
    activeAccountCount: Number(activeAccountCount ?? 0),
  };
}

export async function getDashboardWorkspace(): Promise<DashboardWorkspace> {
  const { db } = await getDatabaseContext();
  return getDashboardWorkspaceInDatabase(db);
}
