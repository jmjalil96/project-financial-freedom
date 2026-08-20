import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  appSettings,
  categories,
  journalEntries,
  ledgerAccounts,
  monthCloseStates,
  monthlyBudgets,
  postings,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { getCalendarMonthBounds } from "@/domain/calendar-date";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import { sumMinorUnits } from "@/domain/money";
import {
  calculateBudgetProgress,
  calendarMonthSchema,
  type BudgetProgressStatus,
} from "@/domain/monthly-report";
import { shiftCalendarMonth } from "@/domain/net-worth";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { assertCalendarMonthOpenInDatabase } from "@/features/month-close/month-lock-service";

type BudgetDatabase = AppDatabase | AppTransaction;

export type BudgetCategoryView = {
  categoryId: number;
  categoryName: string;
  categoryArchivedAt: string | null;
  plannedMinor: number | null;
  actualMinor: number;
  remainingMinor: number | null;
  status: BudgetProgressStatus;
  transactionCount: number;
};

export type BudgetMonthView = {
  targetMonth: string;
  currency: BaseCurrency;
  isClosed: boolean;
  isEditable: boolean;
  plannedTotalMinor: number;
  actualTotalMinor: number;
  remainingTotalMinor: number;
  missingBudgetCount: number;
  categories: BudgetCategoryView[];
};

export function getBudgetMonthInDatabase(
  database: BudgetDatabase,
  targetMonthInput: string,
  ledgerCutoffEntryId?: number | null,
): BudgetMonthView {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const { start, end } = getCalendarMonthBounds(targetMonth);
  const settings = database
    .select({ baseCurrency: appSettings.baseCurrency })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .get();
  if (!settings) {
    throw new DomainError("Complete currency setup before creating a budget.");
  }
  const categoryRows = database
    .select({
      id: categories.id,
      name: categories.name,
      archivedAt: categories.archivedAt,
    })
    .from(categories)
    .where(eq(categories.kind, "expense"))
    .orderBy(asc(categories.archivedAt), asc(categories.name))
    .all();
  const budgetRows = database
    .select({
      id: monthlyBudgets.id,
      categoryId: monthlyBudgets.categoryId,
      amountMinor: monthlyBudgets.amountMinor,
    })
    .from(monthlyBudgets)
    .where(eq(monthlyBudgets.targetMonth, targetMonth))
    .all();
  const budgetByCategory = new Map(
    budgetRows.map((budget) => [budget.categoryId, budget]),
  );
  const actualConditions = [
    eq(journalEntries.isPosted, true),
    sql`${journalEntries.effectiveDate} >= ${start}`,
    sql`${journalEntries.effectiveDate} <= ${end}`,
  ];
  if (ledgerCutoffEntryId !== undefined && ledgerCutoffEntryId !== null) {
    actualConditions.push(lte(journalEntries.id, ledgerCutoffEntryId));
  }
  if (ledgerCutoffEntryId === null) {
    actualConditions.push(sql`0 = 1`);
  }
  const actualRows = database
    .select({
      categoryId: ledgerAccounts.categoryId,
      amountMinor: sql<number>`coalesce(sum(${postings.amountMinor}), 0)`,
      transactionCount: sql<number>`count(distinct ${journalEntries.id})`,
    })
    .from(postings)
    .innerJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(and(...actualConditions, eq(ledgerAccounts.kind, "expense")))
    .groupBy(ledgerAccounts.categoryId)
    .all();
  const actualByCategory = new Map(
    actualRows.flatMap((row) =>
      row.categoryId === null
        ? []
        : [
            [
              row.categoryId,
              {
                amountMinor: Number(row.amountMinor),
                transactionCount: Number(row.transactionCount),
              },
            ] as const,
          ],
    ),
  );
  const categoryViews = categoryRows
    .map((category): BudgetCategoryView => {
      const plannedMinor = budgetByCategory.get(category.id)?.amountMinor ?? null;
      const actual = actualByCategory.get(category.id) ?? {
        amountMinor: 0,
        transactionCount: 0,
      };
      return {
        categoryId: category.id,
        categoryName: category.name,
        categoryArchivedAt: category.archivedAt,
        plannedMinor,
        actualMinor: actual.amountMinor,
        transactionCount: actual.transactionCount,
        ...calculateBudgetProgress(plannedMinor, actual.amountMinor),
      };
    })
    .filter(
      (category) =>
        category.categoryArchivedAt === null ||
        category.plannedMinor !== null ||
        category.actualMinor !== 0,
    );
  const plannedTotalMinor = sumMinorUnits(
    categoryViews.flatMap((category) =>
      category.plannedMinor === null ? [] : [category.plannedMinor],
    ),
    "The monthly budget total is too large.",
  );
  const actualTotalMinor = sumMinorUnits(
    categoryViews.map((category) => category.actualMinor),
    "The monthly spending total is too large.",
  );
  const closeState = database
    .select({ status: monthCloseStates.status })
    .from(monthCloseStates)
    .where(eq(monthCloseStates.targetMonth, targetMonth))
    .get();
  return {
    targetMonth,
    currency: baseCurrencySchema.parse(settings.baseCurrency),
    isClosed: closeState?.status === "closed",
    isEditable: closeState?.status !== "closed",
    plannedTotalMinor,
    actualTotalMinor,
    remainingTotalMinor: sumMinorUnits(
      [plannedTotalMinor, -actualTotalMinor],
      "The monthly budget variance is too large.",
    ),
    missingBudgetCount: categoryViews.filter(
      (category) =>
        category.categoryArchivedAt === null && category.plannedMinor === null,
    ).length,
    categories: categoryViews,
  };
}

export async function getBudgetMonth(targetMonth: string): Promise<BudgetMonthView> {
  const { db } = await getDatabaseContext();
  return getBudgetMonthInDatabase(db, targetMonth);
}

export async function setMonthlyBudget(input: {
  targetMonth: string;
  categoryId: number;
  amountMinor: number;
}): Promise<number> {
  const targetMonth = calendarMonthSchema.parse(input.targetMonth);
  if (!Number.isSafeInteger(input.categoryId) || input.categoryId <= 0) {
    throw new DomainError("Choose a valid expense category.");
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new DomainError("Budget targets must be nonnegative integer minor units.");
  }
  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      assertCalendarMonthOpenInDatabase(transaction, targetMonth, "editing its budget");
      const category = transaction
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(
          and(
            eq(categories.id, input.categoryId),
            eq(categories.kind, "expense"),
            isNull(categories.archivedAt),
          ),
        )
        .get();
      if (!category) {
        throw new DomainError("Choose an active expense category.");
      }
      transaction
        .insert(monthlyBudgets)
        .values({
          targetMonth,
          categoryId: category.id,
          amountMinor: input.amountMinor,
        })
        .onConflictDoUpdate({
          target: [monthlyBudgets.targetMonth, monthlyBudgets.categoryId],
          set: {
            amountMinor: input.amountMinor,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .run();
      const budget = transaction
        .select({ id: monthlyBudgets.id })
        .from(monthlyBudgets)
        .where(
          and(
            eq(monthlyBudgets.targetMonth, targetMonth),
            eq(monthlyBudgets.categoryId, category.id),
          ),
        )
        .get();
      if (!budget) {
        throw new Error("The monthly budget target was not saved.");
      }
      recordAuditEvent(transaction, {
        action: "budget.target_set",
        entityType: "monthly_budget",
        entityId: budget.id,
        details: {
          targetMonth,
          categoryId: category.id,
          categoryName: category.name,
          amountMinor: input.amountMinor,
        },
      });
      return budget.id;
    },
    { behavior: "immediate" },
  );
}

export async function copyPreviousMonthBudgets(
  targetMonthInput: string,
): Promise<{ copiedCount: number; skippedCount: number; sourceMonth: string }> {
  const targetMonth = calendarMonthSchema.parse(targetMonthInput);
  const sourceMonth = shiftCalendarMonth(targetMonth, -1);
  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      assertCalendarMonthOpenInDatabase(
        transaction,
        targetMonth,
        "copying budget targets into it",
      );
      const sourceBudgets = transaction
        .select({
          categoryId: monthlyBudgets.categoryId,
          amountMinor: monthlyBudgets.amountMinor,
          categoryName: categories.name,
        })
        .from(monthlyBudgets)
        .innerJoin(categories, eq(categories.id, monthlyBudgets.categoryId))
        .where(
          and(
            eq(monthlyBudgets.targetMonth, sourceMonth),
            eq(categories.kind, "expense"),
            isNull(categories.archivedAt),
          ),
        )
        .all();
      if (sourceBudgets.length === 0) {
        return { copiedCount: 0, skippedCount: 0, sourceMonth };
      }
      const existing = transaction
        .select({ categoryId: monthlyBudgets.categoryId })
        .from(monthlyBudgets)
        .where(
          and(
            eq(monthlyBudgets.targetMonth, targetMonth),
            inArray(
              monthlyBudgets.categoryId,
              sourceBudgets.map((budget) => budget.categoryId),
            ),
          ),
        )
        .all();
      const existingIds = new Set(existing.map((budget) => budget.categoryId));
      const toCopy = sourceBudgets.filter(
        (budget) => !existingIds.has(budget.categoryId),
      );
      for (const source of toCopy) {
        const result = transaction
          .insert(monthlyBudgets)
          .values({
            targetMonth,
            categoryId: source.categoryId,
            amountMinor: source.amountMinor,
          })
          .run();
        recordAuditEvent(transaction, {
          action: "budget.target_set",
          entityType: "monthly_budget",
          entityId: Number(result.lastInsertRowid),
          details: {
            targetMonth,
            categoryId: source.categoryId,
            categoryName: source.categoryName,
            amountMinor: source.amountMinor,
            copiedFromMonth: sourceMonth,
          },
        });
      }
      return {
        copiedCount: toCopy.length,
        skippedCount: sourceBudgets.length - toCopy.length,
        sourceMonth,
      };
    },
    { behavior: "immediate" },
  );
}
