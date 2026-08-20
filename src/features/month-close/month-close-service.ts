import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  importBatches,
  importDuplicateCandidates,
  importRowDecisions,
  importRows,
  importTransferResolutions,
  journalEntries,
  monthCloseRevisions,
  monthCloseStates,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { getCalendarMonthBounds, getLocalCalendarDate } from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";
import { formatMoney, sumMinorUnits } from "@/domain/money";
import { calendarMonthSchema } from "@/domain/monthly-report";
import { shiftCalendarMonth } from "@/domain/net-worth";
import { recordAuditEvent } from "@/features/audit/audit-service";
import {
  getMonthCoverageInDatabase,
  type MonthCoverageSummary,
} from "@/features/coverage/coverage-service";
import { loadReviewRowsInDatabase } from "@/features/reconciliation/review-row-loader";
import {
  getMonthlyReportInDatabase,
  type MonthlyReport,
} from "@/features/reports/monthly-report-service";

type CloseDatabase = AppDatabase | AppTransaction;

export type MonthCloseBlocker = {
  code:
    | "month_not_ended"
    | "later_month_already_closed"
    | "previous_month_not_closed"
    | "earlier_month_reopened"
    | "coverage_incomplete"
    | "statement_not_finalized"
    | "transaction_review_incomplete"
    | "duplicate_unresolved"
    | "transfer_unresolved"
    | "transfer_clearing_unexplained"
    | "manual_valuation_missing"
    | "manual_valuation_stale"
    | "adjustment_unexplained";
  group: "sequence" | "coverage" | "review" | "transfers" | "valuations";
  title: string;
  message: string;
  href: string;
};

export type MonthCloseWarning = {
  code:
    | "budget_missing"
    | "nonrequired_coverage"
    | "valuation_carried"
    | "adjustment_acknowledged"
    | "transfer_in_transit";
  message: string;
  href: string;
};

export type IncludedStatement = {
  importBatchId: number;
  sourceFilename: string;
  accountId: number;
  statementStartDate: string;
  statementEndDate: string;
  finalizedAt: string;
};

export type MonthCloseReadiness = {
  targetMonth: string;
  monthEnd: string;
  isReady: boolean;
  blockers: MonthCloseBlocker[];
  warnings: MonthCloseWarning[];
  coverage: MonthCoverageSummary;
  includedStatements: IncludedStatement[];
};

export type CloseRevisionSnapshot = {
  snapshotVersion: 1;
  targetMonth: string;
  ledgerCutoffEntryId: number | null;
  includedStatements: IncludedStatement[];
  coverage: MonthCoverageSummary;
  warnings: MonthCloseWarning[];
  report: MonthlyReport;
};

export type CloseRevisionSummary = {
  id: number;
  targetMonth: string;
  revisionNumber: number;
  previousRevisionId: number | null;
  ledgerCutoffEntryId: number | null;
  closedAt: string;
};

export type MonthCloseWorkspaceView = {
  targetMonth: string;
  state: "provisional" | "ready" | "closed" | "reopened" | "historical";
  activeRevisionId: number | null;
  selectedRevision: CloseRevisionSummary | null;
  revisions: CloseRevisionSummary[];
  readiness: MonthCloseReadiness;
  report: MonthlyReport;
};

function listIncludedStatements(
  database: CloseDatabase,
  targetMonth: string,
): IncludedStatement[] {
  const { start, end } = getCalendarMonthBounds(targetMonth);
  return database
    .select({
      importBatchId: importBatches.id,
      sourceFilename: importBatches.sourceFilename,
      accountId: importBatches.financialAccountId,
      statementStartDate: importBatches.statementStartDate,
      statementEndDate: importBatches.statementEndDate,
      finalizedAt: importBatches.finalizedAt,
    })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.reviewStatus, "finalized"),
        lte(importBatches.statementStartDate, end),
        gte(importBatches.statementEndDate, start),
      ),
    )
    .orderBy(asc(importBatches.statementStartDate), asc(importBatches.id))
    .all()
    .map((statement) => {
      if (!statement.finalizedAt) {
        throw new Error("A finalized statement is missing its finalization time.");
      }
      return { ...statement, finalizedAt: statement.finalizedAt };
    });
}

function getCloseWarnings(
  report: MonthlyReport,
  coverage: MonthCoverageSummary,
  targetMonth: string,
  explainedTransferClearingMinor: number,
): MonthCloseWarning[] {
  const warnings: MonthCloseWarning[] = [];
  if (report.missingBudgetCount > 0) {
    warnings.push({
      code: "budget_missing",
      message: `${report.missingBudgetCount} active expense ${report.missingBudgetCount === 1 ? "category has" : "categories have"} no budget target. Budgets remain optional for close.`,
      href: `/budgets?month=${targetMonth}`,
    });
  }
  const incompleteOptional = coverage.accounts.filter(
    (account) =>
      !account.account.requiredForClose &&
      account.status !== "not_applicable" &&
      account.gaps.length > 0,
  );
  if (incompleteOptional.length > 0) {
    warnings.push({
      code: "nonrequired_coverage",
      message: `${incompleteOptional.length} optional ${incompleteOptional.length === 1 ? "account does" : "accounts do"} not have complete finalized coverage.`,
      href: `/coverage?month=${targetMonth}`,
    });
  }
  for (const item of report.netWorth.manualItems) {
    if (
      item.isApplicable &&
      item.latestValuation?.carriedForwardFromValuationId !== null &&
      item.latestValuation?.carriedForwardFromValuationId !== undefined
    ) {
      warnings.push({
        code: "valuation_carried",
        message: `${item.name} uses an explicitly carried-forward value dated ${item.latestValuation.effectiveDate}.`,
        href: `/net-worth?month=${targetMonth}`,
      });
    }
  }
  for (const adjustment of report.adjustments) {
    if (adjustment.notes.trim()) {
      warnings.push({
        code: "adjustment_acknowledged",
        message: `${adjustment.description} is an evidence-backed position adjustment: ${adjustment.notes}`,
        href: "/transactions",
      });
    }
  }
  if (explainedTransferClearingMinor !== 0) {
    warnings.push({
      code: "transfer_in_transit",
      message: `The ${formatMoney(explainedTransferClearingMinor, report.currency)} transfer-clearing balance is fully explained by resolved transfers crossing the month-end boundary or marked in transit.`,
      href: "/transfers",
    });
  }
  return warnings;
}

function parseRevisionSummary(
  revision: typeof monthCloseRevisions.$inferSelect,
): CloseRevisionSummary {
  return {
    id: revision.id,
    targetMonth: revision.targetMonth,
    revisionNumber: revision.revisionNumber,
    previousRevisionId: revision.previousRevisionId,
    ledgerCutoffEntryId: revision.ledgerCutoffEntryId,
    closedAt: revision.closedAt,
  };
}

function parseSnapshot(value: string, targetMonth: string): CloseRevisionSnapshot {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("snapshotVersion" in parsed) ||
    parsed.snapshotVersion !== 1 ||
    !("targetMonth" in parsed) ||
    parsed.targetMonth !== targetMonth ||
    !("report" in parsed)
  ) {
    throw new Error("The stored month-close snapshot is invalid.");
  }
  return parsed as CloseRevisionSnapshot;
}

function getReadinessInDatabase(
  database: CloseDatabase,
  targetMonthInput: string,
  report: MonthlyReport,
  today = getLocalCalendarDate(),
): MonthCloseReadiness {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const { start: monthStart, end: monthEnd } = getCalendarMonthBounds(targetMonth);
  const blockers: MonthCloseBlocker[] = [];
  const previousMonth = shiftCalendarMonth(targetMonth, -1);
  const previousState = database
    .select({ status: monthCloseStates.status })
    .from(monthCloseStates)
    .where(eq(monthCloseStates.targetMonth, previousMonth))
    .get();
  const earliestRevision = database
    .select({ targetMonth: monthCloseRevisions.targetMonth })
    .from(monthCloseRevisions)
    .orderBy(asc(monthCloseRevisions.targetMonth))
    .get();
  const earlierReopened = database
    .select({ targetMonth: monthCloseStates.targetMonth })
    .from(monthCloseStates)
    .where(
      and(
        eq(monthCloseStates.status, "reopened"),
        sql`${monthCloseStates.targetMonth} < ${targetMonth}`,
      ),
    )
    .orderBy(asc(monthCloseStates.targetMonth))
    .get();
  const laterClosed = database
    .select({ targetMonth: monthCloseStates.targetMonth })
    .from(monthCloseStates)
    .where(
      and(
        eq(monthCloseStates.status, "closed"),
        sql`${monthCloseStates.targetMonth} > ${targetMonth}`,
      ),
    )
    .orderBy(asc(monthCloseStates.targetMonth))
    .get();
  if (monthEnd >= today) {
    blockers.push({
      code: "month_not_ended",
      group: "sequence",
      title: "The calendar month has not ended",
      message: `Wait until after ${monthEnd}; a complete month cannot be proven before its final day has passed.`,
      href: `/month-close?month=${targetMonth}`,
    });
  }
  if (earlierReopened) {
    blockers.push({
      code: "earlier_month_reopened",
      group: "sequence",
      title: `${earlierReopened.targetMonth} must be reclosed first`,
      message:
        "Reopened months are recalculated chronologically so later comparisons remain trustworthy.",
      href: `/month-close?month=${earlierReopened.targetMonth}`,
    });
  } else if (laterClosed) {
    blockers.push({
      code: "later_month_already_closed",
      group: "sequence",
      title: `${laterClosed.targetMonth} is already closed`,
      message:
        "Reopen the later closed month before inserting an earlier month into the close sequence.",
      href: `/month-close?month=${laterClosed.targetMonth}`,
    });
  } else if (
    earliestRevision &&
    earliestRevision.targetMonth < targetMonth &&
    previousState?.status !== "closed"
  ) {
    blockers.push({
      code: "previous_month_not_closed",
      group: "sequence",
      title: `${previousMonth} is not closed`,
      message: "Close the immediately preceding calendar month before this one.",
      href: `/month-close?month=${previousMonth}`,
    });
  }
  const coverage = getMonthCoverageInDatabase(
    database,
    targetMonth,
    previousState?.status === "closed"
      ? getCalendarMonthBounds(previousMonth).end
      : null,
  );
  for (const account of coverage.accounts.filter(
    (candidate) =>
      candidate.account.requiredForClose &&
      candidate.status !== "complete" &&
      candidate.status !== "not_applicable",
  )) {
    blockers.push({
      code: "coverage_incomplete",
      group: "coverage",
      title: `${account.account.name} coverage is incomplete`,
      message:
        account.status === "pending_finalization"
          ? "The needed statement coverage exists but is not finalized."
          : account.gaps.length > 0
            ? `Missing finalized coverage from ${account.gaps[0]!.start} through ${account.gaps[0]!.end}.`
            : "No finalized statement evidence covers the required interval.",
      href: `/coverage?month=${targetMonth}`,
    });
  }
  const pendingStatements = database
    .select({
      id: importBatches.id,
      sourceFilename: importBatches.sourceFilename,
    })
    .from(importBatches)
    .where(
      and(
        ne(importBatches.reviewStatus, "finalized"),
        lte(importBatches.statementStartDate, monthEnd),
        gte(importBatches.statementEndDate, monthStart),
      ),
    )
    .orderBy(asc(importBatches.id))
    .all();
  for (const statement of pendingStatements) {
    blockers.push({
      code: "statement_not_finalized",
      group: "review",
      title: `${statement.sourceFilename} is not finalized`,
      message: "Finish its transaction review and exact reconciliation before closing.",
      href: `/imports/${statement.id}/review`,
    });
  }
  const reviewRows = loadReviewRowsInDatabase(database, {
    nonFinalizedOnly: true,
  }).filter(
    (row) =>
      (row.decision.effectiveDate ?? row.defaultEffectiveDate).slice(0, 7) ===
      targetMonth,
  );
  const incompleteRows = reviewRows.filter((row) => row.blockers.length > 0);
  if (incompleteRows.length > 0) {
    const first = incompleteRows[0]!;
    blockers.push({
      code: "transaction_review_incomplete",
      group: "review",
      title: `${incompleteRows.length} transaction ${incompleteRows.length === 1 ? "decision is" : "decisions are"} incomplete`,
      message: `Row ${first.originalRowNumber} in ${first.batch.sourceFilename}: ${first.blockers[0]!.message}`,
      href: `/imports/${first.importBatchId}/review`,
    });
  }
  const openDuplicateRows = database
    .select({ id: importDuplicateCandidates.id })
    .from(importDuplicateCandidates)
    .innerJoin(importRows, eq(importRows.id, importDuplicateCandidates.importRowId))
    .leftJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
    .where(
      and(
        eq(importDuplicateCandidates.status, "open"),
        sql`substr(coalesce(${importRowDecisions.effectiveDate}, ${importRows.defaultEffectiveDate}), 1, 7) = ${targetMonth}`,
      ),
    )
    .all();
  if (openDuplicateRows.length > 0) {
    blockers.push({
      code: "duplicate_unresolved",
      group: "review",
      title: `${openDuplicateRows.length} duplicate ${openDuplicateRows.length === 1 ? "candidate remains" : "candidates remain"}`,
      message: "Confirm or dismiss every duplicate candidate affecting the month.",
      href: "/review?filter=duplicate_candidates",
    });
  }
  const unresolvedTransfers = database
    .select({ id: importRows.id, description: importRows.description })
    .from(importRowDecisions)
    .innerJoin(importRows, eq(importRows.id, importRowDecisions.importRowId))
    .leftJoin(
      importTransferResolutions,
      eq(importTransferResolutions.importRowId, importRows.id),
    )
    .where(
      and(
        eq(importRowDecisions.disposition, "accepted"),
        eq(importRowDecisions.confirmedType, "transfer"),
        sql`substr(${importRowDecisions.effectiveDate}, 1, 7) = ${targetMonth}`,
        isNull(importTransferResolutions.id),
      ),
    )
    .all();
  if (unresolvedTransfers.length > 0) {
    blockers.push({
      code: "transfer_unresolved",
      group: "transfers",
      title: `${unresolvedTransfers.length} transfer ${unresolvedTransfers.length === 1 ? "needs" : "need"} an explanation`,
      message: `Match or explicitly classify ${unresolvedTransfers[0]!.description}.`,
      href: "/transfers",
    });
  }
  const explainedTransferRows = database
    .select({ amountMinor: importRows.amountMinor })
    .from(importTransferResolutions)
    .innerJoin(importRows, eq(importRows.id, importTransferResolutions.importRowId))
    .innerJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
    .where(
      and(
        inArray(importTransferResolutions.classification, [
          "owned_account",
          "card_payment",
          "in_transit",
        ]),
        lte(importRowDecisions.effectiveDate, monthEnd),
      ),
    )
    .all();
  const explainedTransferClearingMinor = sumMinorUnits(
    explainedTransferRows.map((row) => -row.amountMinor),
    "The explained transfer-clearing balance is too large.",
  );
  const transferClearingMinor =
    report.netWorth.components.find(
      (component) => component.kind === "transfer_clearing",
    )?.amountMinor ?? 0;
  if (transferClearingMinor !== explainedTransferClearingMinor) {
    blockers.push({
      code: "transfer_clearing_unexplained",
      group: "transfers",
      title: "The transfer-clearing balance is not fully explained",
      message: `The ledger holds ${formatMoney(transferClearingMinor, report.currency)}, while resolved in-transit or cross-month transfers explain ${formatMoney(explainedTransferClearingMinor, report.currency)}.`,
      href: "/transfers",
    });
  }
  for (const item of report.netWorth.manualItems.filter(
    (candidate) => candidate.isApplicable,
  )) {
    if (!item.latestValuation) {
      blockers.push({
        code: "manual_valuation_missing",
        group: "valuations",
        title: `${item.name} has no applicable valuation`,
        message: `Record a value effective on or before ${monthEnd}.`,
        href: `/net-worth?month=${targetMonth}`,
      });
    } else if (item.isStale) {
      blockers.push({
        code: "manual_valuation_stale",
        group: "valuations",
        title: `${item.name} has stale valuation evidence`,
        message: `Record new evidence or explicitly carry forward the ${item.latestValuation.effectiveDate} value.`,
        href: `/net-worth?month=${targetMonth}`,
      });
    }
  }
  for (const adjustment of report.adjustments.filter(
    (candidate) => !candidate.notes.trim(),
  )) {
    blockers.push({
      code: "adjustment_unexplained",
      group: "review",
      title: `${adjustment.description} has no evidence note`,
      message: "Reverse it and post a documented replacement before closing.",
      href: "/transactions",
    });
  }
  const includedStatements = listIncludedStatements(database, targetMonth);
  const warnings = getCloseWarnings(
    report,
    coverage,
    targetMonth,
    explainedTransferClearingMinor,
  );
  return {
    targetMonth,
    monthEnd,
    isReady: blockers.length === 0,
    blockers,
    warnings,
    coverage,
    includedStatements,
  };
}

export function getMonthCloseWorkspaceInDatabase(
  db: CloseDatabase,
  targetMonthInput: string,
  selectedRevisionId?: number,
  today = getLocalCalendarDate(),
): MonthCloseWorkspaceView {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const revisionRows = db
    .select()
    .from(monthCloseRevisions)
    .where(eq(monthCloseRevisions.targetMonth, targetMonth))
    .orderBy(desc(monthCloseRevisions.revisionNumber))
    .all();
  const revisions = revisionRows.map(parseRevisionSummary);
  const state = db
    .select()
    .from(monthCloseStates)
    .where(eq(monthCloseStates.targetMonth, targetMonth))
    .get();
  const selectedRow = selectedRevisionId
    ? revisionRows.find((revision) => revision.id === selectedRevisionId)
    : state?.status === "closed"
      ? revisionRows.find((revision) => revision.id === state.activeRevisionId)
      : undefined;
  if (selectedRevisionId && !selectedRow) {
    throw new DomainError("Choose a close revision from this calendar month.");
  }
  if (selectedRow) {
    const snapshot = parseSnapshot(selectedRow.snapshotJson, targetMonth);
    return {
      targetMonth,
      state: selectedRevisionId ? "historical" : "closed",
      activeRevisionId: state?.status === "closed" ? state.activeRevisionId : null,
      selectedRevision: parseRevisionSummary(selectedRow),
      revisions,
      readiness: {
        targetMonth,
        monthEnd: snapshot.report.monthEnd,
        isReady: true,
        blockers: [],
        warnings: snapshot.warnings,
        coverage: snapshot.coverage,
        includedStatements: snapshot.includedStatements,
      },
      report: snapshot.report,
    };
  }
  const report = getMonthlyReportInDatabase(db, targetMonth);
  const readiness = getReadinessInDatabase(db, targetMonth, report, today);
  return {
    targetMonth,
    state:
      state?.status === "reopened"
        ? "reopened"
        : readiness.isReady
          ? "ready"
          : "provisional",
    activeRevisionId: null,
    selectedRevision: null,
    revisions,
    readiness,
    report,
  };
}

export async function getMonthCloseWorkspace(
  targetMonthInput: string,
  selectedRevisionId?: number,
): Promise<MonthCloseWorkspaceView> {
  const { db } = await getDatabaseContext();
  return getMonthCloseWorkspaceInDatabase(db, targetMonthInput, selectedRevisionId);
}

export async function closeMonth(targetMonthInput: string): Promise<number> {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      const state = transaction
        .select()
        .from(monthCloseStates)
        .where(eq(monthCloseStates.targetMonth, targetMonth))
        .get();
      if (state?.status === "closed") {
        throw new DomainError(`${targetMonth} is already closed.`);
      }
      const cutoff = transaction
        .select({ id: sql<number | null>`max(${journalEntries.id})` })
        .from(journalEntries)
        .where(eq(journalEntries.isPosted, true))
        .get()?.id;
      const ledgerCutoffEntryId =
        cutoff === null || cutoff === undefined ? null : Number(cutoff);
      const report = getMonthlyReportInDatabase(
        transaction,
        targetMonth,
        ledgerCutoffEntryId,
      );
      const readiness = getReadinessInDatabase(transaction, targetMonth, report);
      if (!readiness.isReady) {
        const first = readiness.blockers[0]!;
        throw new DomainError(
          `${first.title}. ${first.message}${readiness.blockers.length > 1 ? ` ${readiness.blockers.length - 1} additional closing blocker${readiness.blockers.length === 2 ? " remains" : "s remain"}.` : ""}`,
        );
      }
      const latestRevision = transaction
        .select()
        .from(monthCloseRevisions)
        .where(eq(monthCloseRevisions.targetMonth, targetMonth))
        .orderBy(desc(monthCloseRevisions.revisionNumber))
        .get();
      const snapshot: CloseRevisionSnapshot = {
        snapshotVersion: 1,
        targetMonth,
        ledgerCutoffEntryId,
        includedStatements: readiness.includedStatements,
        coverage: readiness.coverage,
        warnings: readiness.warnings,
        report,
      };
      const result = transaction
        .insert(monthCloseRevisions)
        .values({
          targetMonth,
          revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
          previousRevisionId: latestRevision?.id ?? null,
          ledgerCutoffEntryId,
          incomeMinor: report.incomeMinor,
          expensesMinor: report.expensesMinor,
          savingsMinor: report.savingsMinor,
          savingsRateBasisPoints: report.savingsRateBasisPoints,
          budgetPlannedMinor: report.budgetPlannedMinor,
          budgetActualMinor: report.budgetActualMinor,
          debtMinor: report.netWorth.debtMinor,
          debtChangeMinor: report.netWorth.debtChangeMinor,
          netWorthMinor: report.netWorth.netWorthMinor,
          netWorthChangeMinor: report.netWorth.changeMinor,
          warningCount: readiness.warnings.length,
          snapshotJson: JSON.stringify(snapshot),
        })
        .run();
      const revisionId = Number(result.lastInsertRowid);
      if (state) {
        transaction
          .update(monthCloseStates)
          .set({
            status: "closed",
            activeRevisionId: revisionId,
            latestRevisionId: revisionId,
            lastReopenedAt: null,
            lastReopenReason: null,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(monthCloseStates.targetMonth, targetMonth))
          .run();
      } else {
        transaction
          .insert(monthCloseStates)
          .values({
            targetMonth,
            status: "closed",
            activeRevisionId: revisionId,
            latestRevisionId: revisionId,
          })
          .run();
      }
      recordAuditEvent(transaction, {
        action: "month.closed",
        entityType: "month_close_revision",
        entityId: revisionId,
        details: {
          targetMonth,
          revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
          previousRevisionId: latestRevision?.id ?? null,
          ledgerCutoffEntryId,
          includedStatementIds: readiness.includedStatements.map(
            (statement) => statement.importBatchId,
          ),
          warningCount: readiness.warnings.length,
        },
      });
      return revisionId;
    },
    { behavior: "immediate" },
  );
}

export async function reopenMonth(input: {
  targetMonth: string;
  reason: string;
}): Promise<{ invalidatedMonths: string[] }> {
  const targetMonth = calendarMonthSchema.parse(input.targetMonth);
  const reason = input.reason.trim();
  if (!reason) {
    throw new DomainError("Explain why this closed month must be reopened.");
  }
  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      const targetState = transaction
        .select()
        .from(monthCloseStates)
        .where(eq(monthCloseStates.targetMonth, targetMonth))
        .get();
      if (targetState?.status !== "closed") {
        throw new DomainError(`${targetMonth} is not currently closed.`);
      }
      const affected = transaction
        .select()
        .from(monthCloseStates)
        .where(
          and(
            eq(monthCloseStates.status, "closed"),
            gte(monthCloseStates.targetMonth, targetMonth),
          ),
        )
        .orderBy(asc(monthCloseStates.targetMonth))
        .all();
      for (const month of affected) {
        transaction
          .update(monthCloseStates)
          .set({
            status: "reopened",
            activeRevisionId: null,
            lastReopenedAt: sql`CURRENT_TIMESTAMP`,
            lastReopenReason: reason,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(monthCloseStates.targetMonth, month.targetMonth))
          .run();
      }
      recordAuditEvent(transaction, {
        action: "month.reopened",
        entityType: "month_close_revision",
        entityId: targetState.latestRevisionId,
        details: {
          targetMonth,
          reason,
          invalidatedMonths: affected.map((month) => month.targetMonth),
        },
      });
      return { invalidatedMonths: affected.map((month) => month.targetMonth) };
    },
    { behavior: "immediate" },
  );
}
