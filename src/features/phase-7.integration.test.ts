import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import { createFinancialAccount } from "@/features/accounts/account-service";
import {
  copyPreviousMonthBudgets,
  setMonthlyBudget,
} from "@/features/budgets/budget-service";
import {
  closeMonth,
  getMonthCloseWorkspace,
  reopenMonth,
} from "@/features/month-close/month-close-service";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
} from "@/features/imports/import-service";
import {
  carryForwardManualValuation,
  createManualItem,
  recordManualValuation,
} from "@/features/net-worth/net-worth-service";
import { finalizeImportBatch } from "@/features/reconciliation/finalization-service";
import { saveRowDecision } from "@/features/reconciliation/review-service";
import { getMonthlyReport } from "@/features/reports/monthly-report-service";
import { createManualTransaction } from "@/features/transactions/manual-transaction-service";
import { classifyTransfer } from "@/features/transfers/transfer-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../test-fixtures/database-test-context";

const encoder = new TextEncoder();
let context: DatabaseContext;
let temporaryRoot: string;
let salaryCategoryId: number;
let housingCategoryId: number;
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
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-phase-seven-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
  const categories = context.raw
    .prepare("SELECT id, slug FROM categories")
    .all() as Array<{ id: number; slug: string }>;
  salaryCategoryId = categories.find((category) => category.slug === "salary")!.id;
  housingCategoryId = categories.find((category) => category.slug === "housing")!.id;
  groceriesCategoryId = categories.find(
    (category) => category.slug === "groceries",
  )!.id;
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 7 budgets, reports, and month closure", () => {
  it("reports ledger-exact budget actuals and preserves immutable close revisions", async () => {
    const checkingId = await createFinancialAccount({
      name: "Monthly review checking",
      type: "checking",
      openingDate: "2025-01-01",
      openingBalanceMinor: 100_000,
      requiredForClose: false,
    });
    const savingsId = await createFinancialAccount({
      name: "Monthly review savings",
      type: "savings",
      openingDate: "2025-01-01",
      openingBalanceMinor: 0,
      requiredForClose: false,
    });
    await setMonthlyBudget({
      targetMonth: "2024-12",
      categoryId: housingCategoryId,
      amountMinor: 45_000,
    });
    await setMonthlyBudget({
      targetMonth: "2024-12",
      categoryId: groceriesCategoryId,
      amountMinor: 20_000,
    });
    await setMonthlyBudget({
      targetMonth: "2025-01",
      categoryId: housingCategoryId,
      amountMinor: 50_000,
    });
    await expect(copyPreviousMonthBudgets("2025-01")).resolves.toEqual({
      copiedCount: 1,
      skippedCount: 1,
      sourceMonth: "2024-12",
    });
    await createManualTransaction({
      kind: "income",
      effectiveDate: "2025-01-05",
      description: "January salary",
      amountMinor: 100_000,
      financialAccountId: checkingId,
      categoryId: salaryCategoryId,
    });
    await createManualTransaction({
      kind: "expense",
      effectiveDate: "2025-01-10",
      description: "January rent",
      amountMinor: 40_000,
      financialAccountId: checkingId,
      categoryId: housingCategoryId,
    });
    await createManualTransaction({
      kind: "refund",
      effectiveDate: "2025-01-15",
      description: "Rent correction",
      amountMinor: 10_000,
      financialAccountId: checkingId,
      categoryId: housingCategoryId,
    });
    await createManualTransaction({
      kind: "transfer",
      effectiveDate: "2025-01-20",
      description: "Move to savings",
      amountMinor: 5_000,
      financialAccountId: checkingId,
      destinationFinancialAccountId: savingsId,
    });

    const report = await getMonthlyReport("2025-01");
    expect(report).toMatchObject({
      incomeMinor: 100_000,
      expensesMinor: 30_000,
      savingsMinor: 70_000,
      savingsRateBasisPoints: 7_000,
      budgetPlannedMinor: 70_000,
      budgetActualMinor: 30_000,
    });
    expect(report.expenseSources.map((source) => source.amountMinor)).toEqual([
      40_000, -10_000,
    ]);
    expect(report.incomeSources).toHaveLength(1);
    expect(report.incomeSources[0]?.description).toBe("January salary");
    expect(
      report.expenseSources.some((source) => source.description.includes("Move")),
    ).toBe(false);

    const firstRevisionId = await closeMonth("2025-01");
    const closed = await getMonthCloseWorkspace("2025-01");
    expect(closed).toMatchObject({
      state: "closed",
      activeRevisionId: firstRevisionId,
      selectedRevision: { revisionNumber: 1 },
      report: { expensesMinor: 30_000, savingsMinor: 70_000 },
    });
    await expect(
      setMonthlyBudget({
        targetMonth: "2025-01",
        categoryId: housingCategoryId,
        amountMinor: 60_000,
      }),
    ).rejects.toThrow("is closed");
    await expect(
      createManualTransaction({
        kind: "expense",
        effectiveDate: "2025-01-25",
        description: "Late expense",
        amountMinor: 1_000,
        financialAccountId: checkingId,
        categoryId: housingCategoryId,
      }),
    ).rejects.toThrow("is closed");
    expect(() =>
      context.raw
        .prepare("UPDATE month_close_revisions SET income_minor = 0 WHERE id = ?")
        .run(firstRevisionId),
    ).toThrow("immutable");

    await reopenMonth({
      targetMonth: "2025-01",
      reason: "A late receipt changes January spending.",
    });
    await setMonthlyBudget({
      targetMonth: "2025-01",
      categoryId: housingCategoryId,
      amountMinor: 60_000,
    });
    await createManualTransaction({
      kind: "expense",
      effectiveDate: "2025-01-25",
      description: "Late expense",
      amountMinor: 1_000,
      financialAccountId: checkingId,
      categoryId: housingCategoryId,
    });
    const secondRevisionId = await closeMonth("2025-01");
    const reclosed = await getMonthCloseWorkspace("2025-01");
    expect(reclosed).toMatchObject({
      activeRevisionId: secondRevisionId,
      revisions: [
        { id: secondRevisionId, revisionNumber: 2 },
        { id: firstRevisionId, revisionNumber: 1 },
      ],
      report: { expensesMinor: 31_000 },
    });
    const historical = await getMonthCloseWorkspace("2025-01", firstRevisionId);
    expect(historical).toMatchObject({
      state: "historical",
      report: { expensesMinor: 30_000, budgetPlannedMinor: 70_000 },
    });
  });

  it("waits for the statement after a card's 15th closing date", async () => {
    const cardId = await createFinancialAccount({
      name: "Irregular close card",
      type: "credit_card",
      openingDate: "2025-07-16",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const insert = context.raw.prepare(
      `INSERT INTO import_batches (
         financial_account_id, source_filename, file_checksum, csv_schema_version,
         currency, statement_start_date, statement_end_date,
         opening_balance_minor, closing_balance_minor, row_count, warning_count,
         validation_status, review_status, finalized_at, ledger_posted_at
       ) VALUES (?, ?, ?, 'csv-v1', 'USD', ?, ?, 0, 0, 1, 0, 'validated', ?, ?, ?)`,
    );
    insert.run(
      cardId,
      "card-july-16-august-15.csv",
      "a".repeat(64),
      "2025-07-16",
      "2025-08-15",
      "finalized",
      "2025-08-16 00:00:00",
      "2025-08-16 00:00:00",
    );
    const later = insert.run(
      cardId,
      "card-august-16-september-15.csv",
      "b".repeat(64),
      "2025-08-16",
      "2025-09-15",
      "in_review",
      null,
      null,
    );

    const blocked = await getMonthCloseWorkspace("2025-08");
    expect(blocked.state).toBe("provisional");
    expect(blocked.readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "coverage_incomplete" }),
        expect.objectContaining({ code: "statement_not_finalized" }),
      ]),
    );
    context.raw
      .prepare(
        `UPDATE import_batches
         SET review_status = 'finalized', finalized_at = CURRENT_TIMESTAMP,
             ledger_posted_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(Number(later.lastInsertRowid));

    const ready = await getMonthCloseWorkspace("2025-08");
    expect(ready).toMatchObject({
      state: "ready",
      readiness: {
        isReady: true,
        coverage: { isCoverageComplete: true },
        includedStatements: [{}, {}],
      },
    });
    await expect(closeMonth("2025-08")).resolves.toBeGreaterThan(0);
  });

  it("reopens every later revision before accepting earlier-dated evidence", async () => {
    const checkingId = await createFinancialAccount({
      name: "Historical lock checking",
      type: "checking",
      openingDate: "2024-12-01",
      openingBalanceMinor: 10_000,
      requiredForClose: false,
    });
    const itemId = await createManualItem({
      name: "Historical lock asset",
      kind: "asset",
      openingDate: "2024-12-01",
      valuationFrequency: "ad_hoc",
    });
    await recordManualValuation({
      manualItemId: itemId,
      effectiveDate: "2024-12-31",
      naturalValueMinor: 25_000,
      sourceNote: "Initial evidence before close",
    });
    const januaryRevisionId = await closeMonth("2025-01");
    const februaryRevisionId = await closeMonth("2025-02");

    await expect(
      createManualTransaction({
        kind: "expense",
        effectiveDate: "2024-12-20",
        description: "Evidence discovered after close",
        amountMinor: 1_000,
        financialAccountId: checkingId,
        categoryId: housingCategoryId,
      }),
    ).rejects.toThrow("2025-01 is closed and would be affected");
    await expect(
      recordManualValuation({
        manualItemId: itemId,
        effectiveDate: "2024-12-31",
        naturalValueMinor: 26_000,
        sourceNote: "Corrected evidence discovered after close",
      }),
    ).rejects.toThrow("2025-01 is closed and would be affected");
    await expect(
      createFinancialAccount({
        name: "Late historical account",
        type: "cash",
        openingDate: "2024-12-15",
        openingBalanceMinor: 0,
        requiredForClose: false,
      }),
    ).rejects.toThrow("2025-01 is closed and would be affected");
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO financial_accounts
           (name, type, currency, opening_date, required_for_close)
           VALUES ('Raw late historical account', 'cash', 'USD', '2024-12-15', 0)`,
        )
        .run(),
    ).toThrow("closed months prevent this account start date");

    await expect(
      reopenMonth({
        targetMonth: "2025-01",
        reason: "Earlier evidence changes January and February balances.",
      }),
    ).resolves.toEqual({ invalidatedMonths: ["2025-01", "2025-02"] });
    expect(await getMonthCloseWorkspace("2025-02")).toMatchObject({
      state: "reopened",
      activeRevisionId: null,
      revisions: [{ id: februaryRevisionId, revisionNumber: 1 }],
      readiness: {
        isReady: false,
        blockers: [expect.objectContaining({ code: "earlier_month_reopened" })],
      },
    });
    expect(await getMonthCloseWorkspace("2025-01", januaryRevisionId)).toMatchObject({
      state: "historical",
      selectedRevision: { id: januaryRevisionId },
    });

    await expect(
      createManualTransaction({
        kind: "expense",
        effectiveDate: "2024-12-20",
        description: "Evidence discovered after reopen",
        amountMinor: 1_000,
        financialAccountId: checkingId,
        categoryId: housingCategoryId,
      }),
    ).resolves.toBeGreaterThan(0);
    await expect(closeMonth("2025-01")).resolves.toBeGreaterThan(0);
    expect((await getMonthCloseWorkspace("2025-02")).readiness.isReady).toBe(true);
  });

  it("requires transfer explanations and current or carried valuation evidence", async () => {
    const checkingId = await createFinancialAccount({
      name: "Readiness checking",
      type: "checking",
      openingDate: "2025-03-01",
      openingBalanceMinor: 10_000,
      requiredForClose: false,
    });
    const batchId = await commit({
      financialAccountId: checkingId,
      statementStartDate: "2025-03-01",
      statementEndDate: "2025-03-31",
      openingBalance: "100.00",
      closingBalance: "90.00",
      sourceFilename: "march-transfer.csv",
      bytes: encoder.encode(
        "transaction_date,description,amount,currency,type\n2025-03-10,Transfer awaiting destination,-10.00,USD,transfer",
      ),
    });
    const row = context.raw
      .prepare("SELECT id FROM import_rows WHERE import_batch_id = ?")
      .get(batchId) as { id: number };
    await saveRowDecision({
      importRowId: row.id,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    await finalizeImportBatch(batchId);
    const vehicleId = await createManualItem({
      name: "Readiness vehicle",
      kind: "asset",
      openingDate: "2025-02-01",
      valuationFrequency: "monthly",
    });
    const februaryValuationId = await recordManualValuation({
      manualItemId: vehicleId,
      effectiveDate: "2025-02-28",
      naturalValueMinor: 500_000,
      sourceNote: "February market guide",
    });

    const blocked = await getMonthCloseWorkspace("2025-03");
    expect(blocked.readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "transfer_unresolved" }),
        expect.objectContaining({ code: "transfer_clearing_unexplained" }),
        expect.objectContaining({ code: "manual_valuation_stale" }),
      ]),
    );
    await classifyTransfer({
      importRowId: row.id,
      classification: "in_transit",
    });
    await carryForwardManualValuation({
      manualItemId: vehicleId,
      sourceValuationId: februaryValuationId,
      effectiveDate: "2025-03-31",
      acknowledgment: "No material condition or market change in March.",
    });
    const ready = await getMonthCloseWorkspace("2025-03");
    expect(ready.readiness.blockers).toEqual([]);
    expect(ready.readiness.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "valuation_carried" }),
        expect.objectContaining({ code: "transfer_in_transit" }),
      ]),
    );
    await expect(closeMonth("2025-03")).resolves.toBeGreaterThan(0);
  });
});
