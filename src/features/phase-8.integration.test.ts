import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import { createFinancialAccount } from "@/features/accounts/account-service";
import { setMonthlyBudget } from "@/features/budgets/budget-service";
import { getDashboardWorkspaceInDatabase } from "@/features/dashboard/dashboard-service";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
} from "@/features/imports/import-service";
import { closeMonth } from "@/features/month-close/month-close-service";
import { finalizeImportBatch } from "@/features/reconciliation/finalization-service";
import { saveRowDecision } from "@/features/reconciliation/review-service";
import { createManualTransaction } from "@/features/transactions/manual-transaction-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../test-fixtures/database-test-context";

const encoder = new TextEncoder();
let context: DatabaseContext;
let temporaryRoot: string;
let salaryCategoryId: number;
let diningCategoryId: number;
let groceriesCategoryId: number;

async function commit(input: ImportSourceInput): Promise<number> {
  const validation = await validateImportSource(input);
  if (validation.status !== "ready") {
    throw new Error(validation.errors[0]?.message ?? "Import validation failed.");
  }
  const result = await commitValidatedImport(input, validation.preview.approvalToken);
  if (result.status !== "committed") {
    throw new Error(result.errors[0]?.message ?? "Import commit failed.");
  }
  return result.batchId;
}

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-phase-eight-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
  const categories = context.raw
    .prepare("SELECT id, slug FROM categories")
    .all() as Array<{ id: number; slug: string }>;
  salaryCategoryId = categories.find((category) => category.slug === "salary")!.id;
  diningCategoryId = categories.find((category) => category.slug === "dining")!.id;
  groceriesCategoryId = categories.find(
    (category) => category.slug === "groceries",
  )!.id;
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 8 decision-focused dashboard", () => {
  it("uses the last immutable close for comparisons and the current month for tasks", async () => {
    const accountId = await createFinancialAccount({
      name: "Dashboard cash",
      type: "cash",
      openingDate: "2025-01-01",
      openingBalanceMinor: 200_000,
      requiredForClose: false,
    });
    for (const input of [
      {
        kind: "income" as const,
        effectiveDate: "2025-01-05",
        description: "January salary",
        amountMinor: 100_000,
        categoryId: salaryCategoryId,
      },
      {
        kind: "expense" as const,
        effectiveDate: "2025-01-08",
        description: "Dining out",
        amountMinor: 1_000,
        categoryId: diningCategoryId,
      },
      {
        kind: "expense" as const,
        effectiveDate: "2025-01-15",
        description: "Monthly software",
        amountMinor: 500,
        categoryId: groceriesCategoryId,
      },
    ]) {
      await createManualTransaction({
        ...input,
        financialAccountId: accountId,
      });
    }
    await closeMonth("2025-01");
    await setMonthlyBudget({
      targetMonth: "2025-02",
      categoryId: groceriesCategoryId,
      amountMinor: 2_000,
    });
    for (const input of [
      {
        kind: "income" as const,
        effectiveDate: "2025-02-05",
        description: "February salary",
        amountMinor: 110_000,
        categoryId: salaryCategoryId,
      },
      {
        kind: "expense" as const,
        effectiveDate: "2025-02-08",
        description: "Dining out",
        amountMinor: 2_500,
        categoryId: diningCategoryId,
      },
      {
        kind: "expense" as const,
        effectiveDate: "2025-02-15",
        description: "Monthly software",
        amountMinor: 500,
        categoryId: groceriesCategoryId,
      },
      {
        kind: "expense" as const,
        effectiveDate: "2025-02-20",
        description: "Groceries",
        amountMinor: 2_500,
        categoryId: groceriesCategoryId,
      },
    ]) {
      await createManualTransaction({
        ...input,
        financialAccountId: accountId,
      });
    }
    await closeMonth("2025-02");

    const dashboard = getDashboardWorkspaceInDatabase(context.db, "2025-03-15");
    expect(dashboard).toMatchObject({
      currentMonth: "2025-03",
      focusMonth: "2025-02",
      focusState: "closed",
      lastClosed: { targetMonth: "2025-02", revisionNumber: 1 },
      comparisonMonth: "2025-01",
      comparisonHasEvidence: true,
      focusReport: {
        incomeMinor: 110_000,
        expensesMinor: 5_500,
        savingsMinor: 104_500,
      },
      comparison: {
        incomeChangeMinor: 10_000,
        cashFlowContributionMinor: 104_500,
        manualValueContributionMinor: 0,
        otherPositionContributionMinor: 0,
        overBudget: [
          expect.objectContaining({
            categoryName: "Groceries",
            overByMinor: 1_000,
          }),
        ],
      },
      attentionCount: 0,
    });
    expect(dashboard.repeatedDescriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "Monthly software",
          monthCount: 2,
          occurrenceCount: 2,
        }),
      ]),
    );
    expect(
      dashboard.comparison.largestSpending.map((category) => category.categoryName),
    ).toEqual(["Groceries", "Dining"]);
    expect(
      dashboard.comparison.categoryIncreases.map((category) => [
        category.categoryName,
        category.changeMinor,
      ]),
    ).toEqual([
      ["Groceries", 2_500],
      ["Dining", 1_500],
    ]);
    expect(dashboard.tasks.find((task) => task.id === "close")).toMatchObject({
      status: "waiting",
      count: 0,
    });
  });

  it("surfaces unfinished workflow work and identifies a first-time merchant", async () => {
    const accountId = await createFinancialAccount({
      name: "Dashboard checking",
      type: "checking",
      openingDate: "2025-04-01",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const batchId = await commit({
      financialAccountId: accountId,
      statementStartDate: "2025-04-01",
      statementEndDate: "2025-04-30",
      openingBalance: "0.00",
      closingBalance: "-10.00",
      sourceFilename: "dashboard-april.csv",
      bytes: encoder.encode(
        [
          "transaction_date,description,amount,currency,merchant,type,category",
          "2025-04-10,ACME COFFEE,-10.00,USD,Acme Coffee,expense,Groceries",
        ].join("\n"),
      ),
    });

    const unfinished = getDashboardWorkspaceInDatabase(context.db, "2025-04-15");
    expect(unfinished.focusState).toBe("provisional");
    expect(unfinished.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "imports", status: "attention", count: 1 }),
        expect.objectContaining({ id: "review", status: "attention" }),
        expect.objectContaining({ id: "coverage", status: "attention", count: 1 }),
      ]),
    );

    const row = context.raw
      .prepare("SELECT id FROM import_rows WHERE import_batch_id = ?")
      .get(batchId) as { id: number };
    await saveRowDecision({
      importRowId: row.id,
      disposition: "accepted",
      confirmedType: "expense",
      normalizedMerchant: "Acme Coffee",
      allocations: [{ categoryId: groceriesCategoryId, amountMinor: 1_000 }],
    });
    await finalizeImportBatch(batchId);
    await closeMonth("2025-04");

    const closed = getDashboardWorkspaceInDatabase(context.db, "2025-05-15");
    expect(closed.lastClosed).toMatchObject({ targetMonth: "2025-04" });
    expect(closed.newMerchants).toEqual([
      { name: "Acme Coffee", amountMinor: 1_000, transactionCount: 1 },
    ]);
    expect(closed.tasks.find((task) => task.id === "coverage")).toMatchObject({
      status: "attention",
      count: 1,
    });
  });
});
