import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  categories,
  financialAccounts,
  importBatches,
  importRowDecisions,
  importRowJournalEntries,
  importRows,
  journalEntries,
  ledgerAccounts,
  postings,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import {
  financialAccountTypeSchema,
  type FinancialAccountType,
} from "@/domain/accounts";
import { getCalendarMonthBounds } from "@/domain/calendar-date";
import { type BaseCurrency } from "@/domain/currencies";
import { sumMinorUnits } from "@/domain/money";
import { calculateSavingsMetrics, calendarMonthSchema } from "@/domain/monthly-report";
import {
  getBudgetMonthInDatabase,
  type BudgetCategoryView,
} from "@/features/budgets/budget-service";
import {
  getNetWorthSnapshotInDatabase,
  type NetWorthSnapshot,
} from "@/features/net-worth/net-worth-service";

type ReportDatabase = AppDatabase | AppTransaction;

export type ReportSource = {
  journalEntryId: number;
  effectiveDate: string;
  description: string;
  sourceType: string;
  notes: string | null;
  reversesEntryId: number | null;
  amountMinor: number;
  importSource: {
    importRowId: number;
    importBatchId: number;
    sourceFilename: string;
    originalRowNumber: number;
    merchant: string | null;
  } | null;
};

export type ReportCategory = BudgetCategoryView & {
  kind: "expense";
  sources: ReportSource[];
};

export type IncomeCategoryReport = {
  categoryId: number;
  categoryName: string;
  amountMinor: number;
  sources: ReportSource[];
};

export type AccountBalanceReport = {
  financialAccountId: number;
  accountName: string;
  accountType: FinancialAccountType;
  balanceMinor: number;
  sources: ReportSource[];
};

export type AdjustmentReport = {
  journalEntryId: number;
  effectiveDate: string;
  description: string;
  notes: string;
};

export type MonthlyReport = {
  targetMonth: string;
  monthStart: string;
  monthEnd: string;
  currency: BaseCurrency;
  ledgerCutoffEntryId: number | null;
  incomeMinor: number;
  expensesMinor: number;
  savingsMinor: number;
  savingsRateBasisPoints: number | null;
  budgetPlannedMinor: number;
  budgetActualMinor: number;
  budgetRemainingMinor: number;
  missingBudgetCount: number;
  incomeCategories: IncomeCategoryReport[];
  expenseCategories: ReportCategory[];
  incomeSources: ReportSource[];
  expenseSources: ReportSource[];
  accountBalances: AccountBalanceReport[];
  adjustments: AdjustmentReport[];
  netWorth: NetWorthSnapshot;
};

function cutoffConditions(
  start: string | null,
  end: string,
  cutoff: number | null | undefined,
) {
  const conditions = [
    eq(journalEntries.isPosted, true),
    sql`${journalEntries.effectiveDate} <= ${end}`,
  ];
  if (start) {
    conditions.push(sql`${journalEntries.effectiveDate} >= ${start}`);
  }
  if (cutoff === null) {
    conditions.push(sql`0 = 1`);
  } else if (cutoff !== undefined) {
    conditions.push(lte(journalEntries.id, cutoff));
  }
  return conditions;
}

function attachImportSources(
  database: ReportDatabase,
  rows: Array<Omit<ReportSource, "importSource">>,
): ReportSource[] {
  if (rows.length === 0) {
    return [];
  }
  const entryIds = [...new Set(rows.map((row) => row.journalEntryId))];
  const links = database
    .select({
      journalEntryId: importRowJournalEntries.journalEntryId,
      importRowId: importRows.id,
      importBatchId: importBatches.id,
      sourceFilename: importBatches.sourceFilename,
      originalRowNumber: importRows.originalRowNumber,
      sourceMerchant: importRows.merchant,
      normalizedMerchant: importRowDecisions.normalizedMerchant,
    })
    .from(importRowJournalEntries)
    .innerJoin(importRows, eq(importRows.id, importRowJournalEntries.importRowId))
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .leftJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
    .where(inArray(importRowJournalEntries.journalEntryId, entryIds))
    .all();
  const sourceByEntryId = new Map(
    links.map(({ journalEntryId, sourceMerchant, normalizedMerchant, ...source }) => [
      journalEntryId,
      {
        ...source,
        merchant: normalizedMerchant?.trim() || sourceMerchant?.trim() || null,
      },
    ]),
  );
  return rows.map((row) => ({
    ...row,
    importSource: sourceByEntryId.get(row.journalEntryId) ?? null,
  }));
}

export function getMonthlyReportInDatabase(
  database: ReportDatabase,
  targetMonthInput: string,
  ledgerCutoffEntryId?: number | null,
): MonthlyReport {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const { start: monthStart, end: monthEnd } = getCalendarMonthBounds(targetMonth);
  const budget = getBudgetMonthInDatabase(database, targetMonth, ledgerCutoffEntryId);
  const categoryPostingRows = database
    .select({
      journalEntryId: journalEntries.id,
      effectiveDate: journalEntries.effectiveDate,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      notes: journalEntries.notes,
      reversesEntryId: journalEntries.reversesEntryId,
      postingAmountMinor: postings.amountMinor,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryKind: categories.kind,
    })
    .from(postings)
    .innerJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .innerJoin(categories, eq(categories.id, ledgerAccounts.categoryId))
    .where(and(...cutoffConditions(monthStart, monthEnd, ledgerCutoffEntryId)))
    .orderBy(
      asc(journalEntries.effectiveDate),
      asc(journalEntries.id),
      asc(postings.id),
    )
    .all();
  const sourceRows = attachImportSources(
    database,
    categoryPostingRows.map((row) => ({
      journalEntryId: row.journalEntryId,
      effectiveDate: row.effectiveDate,
      description: row.description,
      sourceType: row.sourceType,
      notes: row.notes,
      reversesEntryId: row.reversesEntryId,
      amountMinor:
        row.categoryKind === "income"
          ? -Number(row.postingAmountMinor)
          : Number(row.postingAmountMinor),
    })),
  );
  const categorizedSources = categoryPostingRows.map((row, index) => ({
    ...sourceRows[index]!,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryKind: row.categoryKind,
  }));
  const incomeSources = categorizedSources.filter(
    (source) => source.categoryKind === "income",
  );
  const expenseSources = categorizedSources.filter(
    (source) => source.categoryKind === "expense",
  );
  const incomeMinor = sumMinorUnits(
    incomeSources.map((source) => source.amountMinor),
    "The monthly income total is too large.",
  );
  const expensesMinor = sumMinorUnits(
    expenseSources.map((source) => source.amountMinor),
    "The monthly expense total is too large.",
  );
  const savings = calculateSavingsMetrics(incomeMinor, expensesMinor);
  const incomeByCategory = new Map<number, IncomeCategoryReport>();
  for (const source of incomeSources) {
    const existing = incomeByCategory.get(source.categoryId);
    if (existing) {
      existing.amountMinor = sumMinorUnits([existing.amountMinor, source.amountMinor]);
      existing.sources.push(source);
    } else {
      incomeByCategory.set(source.categoryId, {
        categoryId: source.categoryId,
        categoryName: source.categoryName,
        amountMinor: source.amountMinor,
        sources: [source],
      });
    }
  }
  const accountRows = database
    .select({
      financialAccountId: financialAccounts.id,
      accountName: financialAccounts.name,
      accountType: financialAccounts.type,
      journalEntryId: journalEntries.id,
      effectiveDate: journalEntries.effectiveDate,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      notes: journalEntries.notes,
      reversesEntryId: journalEntries.reversesEntryId,
      amountMinor: postings.amountMinor,
    })
    .from(financialAccounts)
    .innerJoin(
      ledgerAccounts,
      eq(ledgerAccounts.financialAccountId, financialAccounts.id),
    )
    .leftJoin(postings, eq(postings.ledgerAccountId, ledgerAccounts.id))
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.id, postings.journalEntryId),
        ...cutoffConditions(null, monthEnd, ledgerCutoffEntryId),
      ),
    )
    .where(
      and(
        sql`${financialAccounts.openingDate} <= ${monthEnd}`,
        or(
          isNull(financialAccounts.archivedOn),
          sql`${financialAccounts.archivedOn} >= ${monthEnd}`,
        ),
      ),
    )
    .orderBy(asc(financialAccounts.name), asc(journalEntries.effectiveDate))
    .all();
  const validAccountPostingRows = accountRows.filter(
    (row): row is typeof row & { journalEntryId: number; effectiveDate: string } =>
      row.journalEntryId !== null && row.effectiveDate !== null,
  );
  const accountSourceRows = attachImportSources(
    database,
    validAccountPostingRows.map((row) => ({
      journalEntryId: row.journalEntryId,
      effectiveDate: row.effectiveDate,
      description: row.description!,
      sourceType: row.sourceType!,
      notes: row.notes,
      reversesEntryId: row.reversesEntryId,
      amountMinor: Number(row.amountMinor),
    })),
  );
  const accountSourcesById = new Map<number, ReportSource[]>();
  validAccountPostingRows.forEach((row, index) => {
    const sources = accountSourcesById.get(row.financialAccountId) ?? [];
    sources.push(accountSourceRows[index]!);
    accountSourcesById.set(row.financialAccountId, sources);
  });
  const accountIdentity = new Map(
    accountRows.map((row) => [
      row.financialAccountId,
      {
        financialAccountId: row.financialAccountId,
        accountName: row.accountName,
        accountType: financialAccountTypeSchema.parse(row.accountType),
      },
    ]),
  );
  const accountBalances = [...accountIdentity.values()].map(
    (account): AccountBalanceReport => {
      const sources = accountSourcesById.get(account.financialAccountId) ?? [];
      return {
        ...account,
        balanceMinor: sumMinorUnits(
          sources.map((source) => source.amountMinor),
          `The ${account.accountName} balance is too large.`,
        ),
        sources,
      };
    },
  );
  const adjustmentRows = database
    .select({
      journalEntryId: journalEntries.id,
      effectiveDate: journalEntries.effectiveDate,
      description: journalEntries.description,
      notes: journalEntries.notes,
    })
    .from(journalEntries)
    .innerJoin(postings, eq(postings.journalEntryId, journalEntries.id))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(
      and(
        ...cutoffConditions(monthStart, monthEnd, ledgerCutoffEntryId),
        eq(ledgerAccounts.systemKey, "manual_adjustments"),
      ),
    )
    .orderBy(asc(journalEntries.effectiveDate), asc(journalEntries.id))
    .all();
  const adjustments = adjustmentRows.map((row) => ({
    ...row,
    notes: row.notes ?? "",
  }));
  const expenseCategories = budget.categories.map((category): ReportCategory => ({
    ...category,
    kind: "expense",
    sources: expenseSources.filter(
      (source) => source.categoryId === category.categoryId,
    ),
  }));
  const netWorth = getNetWorthSnapshotInDatabase(database, targetMonth);
  const reportNetWorth: NetWorthSnapshot = {
    ...netWorth,
    manualItems: netWorth.manualItems.map((item) => {
      const valuationHistory = item.valuationHistory.filter(
        (valuation) => valuation.effectiveDate <= monthEnd,
      );
      return {
        ...item,
        valuationHistory,
        valuationCount: valuationHistory.length,
      };
    }),
  };
  return {
    targetMonth,
    monthStart,
    monthEnd,
    currency: budget.currency,
    ledgerCutoffEntryId: ledgerCutoffEntryId ?? null,
    incomeMinor,
    expensesMinor,
    ...savings,
    budgetPlannedMinor: budget.plannedTotalMinor,
    budgetActualMinor: budget.actualTotalMinor,
    budgetRemainingMinor: budget.remainingTotalMinor,
    missingBudgetCount: budget.missingBudgetCount,
    incomeCategories: [...incomeByCategory.values()].sort((left, right) =>
      left.categoryName.localeCompare(right.categoryName),
    ),
    expenseCategories,
    incomeSources,
    expenseSources,
    accountBalances,
    adjustments,
    netWorth: reportNetWorth,
  };
}

export async function getMonthlyReport(targetMonth: string): Promise<MonthlyReport> {
  const { db } = await getDatabaseContext();
  return getMonthlyReportInDatabase(db, targetMonth);
}
