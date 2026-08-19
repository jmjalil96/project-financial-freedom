import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import {
  archiveFinancialAccount,
  createFinancialAccount,
} from "@/features/accounts/account-service";
import { createCategory } from "@/features/categories/category-service";
import { getMonthCoverage } from "@/features/coverage/coverage-service";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
} from "@/features/imports/import-service";
import { finalizeImportBatch } from "@/features/reconciliation/finalization-service";
import { postFinalizedImportBatch } from "@/features/reconciliation/import-posting-service";
import { saveRowDecision } from "@/features/reconciliation/review-service";
import { reverseJournalEntry } from "@/features/ledger/ledger-service";
import { listRecentJournalEntries } from "@/features/transactions/manual-transaction-service";
import {
  classifyTransfer,
  clearTransferClassification,
  confirmTransferMatch,
  getOutsideScopeTransferBalance,
  getTransferClearingBalance,
  listTransferWorkspaceRows,
} from "@/features/transfers/transfer-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../test-fixtures/database-test-context";

const encoder = new TextEncoder();
let context: DatabaseContext;
let temporaryRoot: string;
let expenseCategoryId: number;
let secondExpenseCategoryId: number;
let incomeCategoryId: number;

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

function source(input: {
  accountId: number;
  filename: string;
  openingBalance: string;
  closingBalance: string;
  csv: string;
  statementStartDate?: string;
  statementEndDate?: string;
}): ImportSourceInput {
  return {
    financialAccountId: input.accountId,
    statementStartDate: input.statementStartDate ?? "2026-08-01",
    statementEndDate: input.statementEndDate ?? "2026-08-31",
    openingBalance: input.openingBalance,
    closingBalance: input.closingBalance,
    sourceFilename: input.filename,
    bytes: encoder.encode(input.csv),
  };
}

function importRowIds(batchId: number): number[] {
  return (
    context.raw
      .prepare(
        `SELECT id FROM import_rows
         WHERE import_batch_id = ?
         ORDER BY original_row_number`,
      )
      .all(batchId) as Array<{ id: number }>
  ).map((row) => row.id);
}

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-phase-five-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
  expenseCategoryId = await createCategory({
    name: "Phase Five Food",
    kind: "expense",
  });
  secondExpenseCategoryId = await createCategory({
    name: "Phase Five Household",
    kind: "expense",
  });
  incomeCategoryId = await createCategory({
    name: "Phase Five Salary",
    kind: "income",
  });
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 5 posting, transfers, and coverage", () => {
  it("atomically posts every accepted interpretation with source traceability", async () => {
    const accountId = await createFinancialAccount({
      name: "Primary checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 100_000,
      requiredForClose: true,
    });
    const batchId = await commit(
      source({
        accountId,
        filename: "complete-posting.csv",
        openingBalance: "1000.00",
        closingBalance: "1425.00",
        csv: [
          "transaction_date,posted_date,description,amount,currency,type,notes",
          "2026-08-04,2026-08-05,Split purchase,-100.00,USD,expense,Receipt",
          "2026-08-10,2026-08-11,Salary,500.00,USD,income,Payroll",
          "2026-08-12,2026-08-13,Purchase refund,20.00,USD,refund,Refund receipt",
          "2026-08-14,2026-08-15,Known balance correction,5.00,USD,adjustment,Bank evidence",
        ].join("\n"),
      }),
    );
    const [expenseRowId, incomeRowId, refundRowId, adjustmentRowId] =
      importRowIds(batchId);
    await saveRowDecision({
      importRowId: expenseRowId!,
      disposition: "accepted",
      confirmedType: "expense",
      effectiveDate: "2026-08-04",
      allocations: [
        { categoryId: expenseCategoryId, amountMinor: 7_000 },
        { categoryId: secondExpenseCategoryId, amountMinor: 3_000 },
      ],
    });
    await saveRowDecision({
      importRowId: incomeRowId!,
      disposition: "accepted",
      confirmedType: "income",
      allocations: [{ categoryId: incomeCategoryId, amountMinor: 50_000 }],
    });
    await saveRowDecision({
      importRowId: refundRowId!,
      disposition: "accepted",
      confirmedType: "refund",
      allocations: [{ categoryId: expenseCategoryId, amountMinor: 2_000 }],
    });
    await saveRowDecision({
      importRowId: adjustmentRowId!,
      disposition: "accepted",
      confirmedType: "adjustment",
      reviewNote: "Bank evidence confirms the correction.",
    });

    const receipt = await finalizeImportBatch(batchId);
    expect(receipt).toMatchObject({
      batchId,
      journalEntryCount: 4,
      acceptedCount: 4,
      differenceMinor: 0,
      ledgerPostedAt: expect.any(String),
    });
    expect(
      context.raw
        .prepare(
          `SELECT review_status, finalized_at, ledger_posted_at
           FROM import_batches WHERE id = ?`,
        )
        .get(batchId),
    ).toEqual({
      review_status: "finalized",
      finalized_at: receipt.finalizedAt,
      ledger_posted_at: receipt.ledgerPostedAt,
    });
    expect(
      context.raw
        .prepare(
          `SELECT count(*) AS count
           FROM import_row_journal_entries AS link
           INNER JOIN import_rows AS source ON source.id = link.import_row_id
           WHERE source.import_batch_id = ?`,
        )
        .get(batchId),
    ).toEqual({ count: 4 });
    expect(
      context.raw
        .prepare(
          `SELECT entry.effective_date, source.posted_date
           FROM import_row_journal_entries AS link
           INNER JOIN import_rows AS source ON source.id = link.import_row_id
           INNER JOIN journal_entries AS entry ON entry.id = link.journal_entry_id
           WHERE source.id = ?`,
        )
        .get(expenseRowId),
    ).toEqual({ effective_date: "2026-08-04", posted_date: "2026-08-05" });
    expect(
      context.raw
        .prepare(
          `SELECT coalesce(sum(posting.amount_minor), 0) AS total
           FROM postings AS posting
           INNER JOIN journal_entries AS entry ON entry.id = posting.journal_entry_id
           WHERE entry.source_type = 'import'`,
        )
        .get(),
    ).toEqual({ total: 0 });
    expect(
      context.raw
        .prepare(
          `SELECT coalesce(sum(posting.amount_minor), 0) AS balance
           FROM postings AS posting
           INNER JOIN ledger_accounts AS ledger ON ledger.id = posting.ledger_account_id
           WHERE ledger.financial_account_id = ?`,
        )
        .get(accountId),
    ).toEqual({ balance: 142_500 });
  });

  it("backfills a Phase 4-only finalized statement exactly once", async () => {
    const accountId = await createFinancialAccount({
      name: "Legacy posting checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10_000,
      requiredForClose: true,
    });
    const batchId = await commit(
      source({
        accountId,
        filename: "legacy-finalized.csv",
        openingBalance: "100.00",
        closingBalance: "90.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-04,Legacy expense,-10.00,USD,expense",
      }),
    );
    const [rowId] = importRowIds(batchId);
    await saveRowDecision({
      importRowId: rowId!,
      disposition: "accepted",
      confirmedType: "expense",
      allocations: [{ categoryId: expenseCategoryId, amountMinor: 1_000 }],
    });
    context.raw
      .prepare(
        `UPDATE import_batches
         SET review_status = 'finalized', finalized_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(batchId);

    const first = await postFinalizedImportBatch(batchId);
    const second = await postFinalizedImportBatch(batchId);
    expect(first).toEqual({
      batchId,
      journalEntryCount: 1,
      ledgerPostedAt: expect.any(String),
    });
    expect(second).toEqual(first);
    expect(
      context.raw
        .prepare(
          "SELECT count(*) AS count FROM journal_entries WHERE source_type = 'import'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("posts independent card-payment legs through clearing and confirms the match", async () => {
    const checkingId = await createFinancialAccount({
      name: "Payment checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 100_000,
      requiredForClose: true,
    });
    const cardId = await createFinancialAccount({
      name: "Payment card",
      type: "credit_card",
      openingDate: "2026-08-01",
      openingBalanceMinor: 40_000,
      requiredForClose: true,
    });
    const checkingBatchId = await commit(
      source({
        accountId: checkingId,
        filename: "checking-payment.csv",
        openingBalance: "1000.00",
        closingBalance: "800.00",
        csv: [
          "transaction_date,posted_date,description,amount,currency,type",
          "2026-08-10,2026-08-10,Card payment,-200.00,USD,transfer",
        ].join("\n"),
      }),
    );
    const cardBatchId = await commit(
      source({
        accountId: cardId,
        filename: "card-payment.csv",
        openingBalance: "400.00",
        closingBalance: "200.00",
        csv: [
          "transaction_date,posted_date,description,amount,currency,type",
          "2026-08-11,2026-08-12,Payment received,200.00,USD,transfer",
        ].join("\n"),
      }),
    );
    const [checkingRowId] = importRowIds(checkingBatchId);
    const [cardRowId] = importRowIds(cardBatchId);
    for (const importRowId of [checkingRowId!, cardRowId!]) {
      await saveRowDecision({
        importRowId,
        disposition: "accepted",
        confirmedType: "transfer",
      });
    }
    await finalizeImportBatch(checkingBatchId);
    expect((await getTransferClearingBalance()).amountMinor).toBe(20_000);
    await finalizeImportBatch(cardBatchId);
    expect((await getTransferClearingBalance()).amountMinor).toBe(0);

    await confirmTransferMatch({
      importRowId: checkingRowId!,
      counterpartImportRowId: cardRowId!,
    });
    const workspaceRows = await listTransferWorkspaceRows();
    expect(workspaceRows).toHaveLength(2);
    expect(workspaceRows.map((row) => row.resolution?.classification)).toEqual([
      "card_payment",
      "card_payment",
    ]);
    expect(
      context.raw
        .prepare(
          `SELECT coalesce(sum(posting.amount_minor), 0) AS total
           FROM postings AS posting
           INNER JOIN ledger_accounts AS ledger ON ledger.id = posting.ledger_account_id
           WHERE ledger.kind IN ('income', 'expense')`,
        )
        .get(),
    ).toEqual({ total: 0 });
  });

  it("enforces the match window and clears a stale match when review changes", async () => {
    const firstAccountId = await createFinancialAccount({
      name: "First transfer account",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10_000,
      requiredForClose: true,
    });
    const secondAccountId = await createFinancialAccount({
      name: "Second transfer account",
      type: "savings",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const firstBatchId = await commit(
      source({
        accountId: firstAccountId,
        filename: "first-transfer.csv",
        openingBalance: "100.00",
        closingBalance: "90.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-10,Transfer out,-10.00,USD,transfer",
      }),
    );
    const secondBatchId = await commit(
      source({
        accountId: secondAccountId,
        filename: "second-transfer.csv",
        openingBalance: "0.00",
        closingBalance: "10.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-13,Transfer in,10.00,USD,transfer",
      }),
    );
    const [firstRowId] = importRowIds(firstBatchId);
    const [secondRowId] = importRowIds(secondBatchId);
    for (const importRowId of [firstRowId!, secondRowId!]) {
      await saveRowDecision({
        importRowId,
        disposition: "accepted",
        confirmedType: "transfer",
      });
    }
    await confirmTransferMatch({
      importRowId: firstRowId!,
      counterpartImportRowId: secondRowId!,
    });
    expect(
      context.raw
        .prepare("SELECT count(*) AS count FROM import_transfer_resolutions")
        .get(),
    ).toEqual({ count: 2 });
    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_row_decisions SET confirmed_type = 'expense' WHERE import_row_id = ?",
        )
        .run(firstRowId),
    ).toThrow("clear the transfer resolution");
    await saveRowDecision({
      importRowId: firstRowId!,
      disposition: "accepted",
      confirmedType: "expense",
      allocations: [{ categoryId: expenseCategoryId, amountMinor: 1_000 }],
    });
    expect(
      context.raw
        .prepare("SELECT count(*) AS count FROM import_transfer_resolutions")
        .get(),
    ).toEqual({ count: 0 });

    const farAccountId = await createFinancialAccount({
      name: "Far transfer account",
      type: "savings",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const farBatchId = await commit(
      source({
        accountId: farAccountId,
        filename: "far-transfer.csv",
        openingBalance: "0.00",
        closingBalance: "10.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-14,Far transfer in,10.00,USD,transfer",
      }),
    );
    const [farRowId] = importRowIds(farBatchId);
    await saveRowDecision({
      importRowId: farRowId!,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    await saveRowDecision({
      importRowId: firstRowId!,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO import_transfer_resolutions
             (import_row_id, classification, counterpart_import_row_id)
           VALUES (?, 'owned_account', ?)`,
        )
        .run(firstRowId, farRowId),
    ).toThrow("transfer resolution is inconsistent");
    await expect(
      confirmTransferMatch({
        importRowId: firstRowId!,
        counterpartImportRowId: farRowId!,
      }),
    ).rejects.toThrow("within 3 days");
  });

  it("moves pre-classified external transfers out of clearing when they post", async () => {
    const accountId = await createFinancialAccount({
      name: "Outside-scope source",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10_000,
      requiredForClose: true,
    });
    const batchId = await commit(
      source({
        accountId,
        filename: "outside-scope-before-posting.csv",
        openingBalance: "100.00",
        closingBalance: "90.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-10,Transfer to brokerage,-10.00,USD,transfer",
      }),
    );
    const [rowId] = importRowIds(batchId);
    await saveRowDecision({
      importRowId: rowId!,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    await classifyTransfer({
      importRowId: rowId!,
      classification: "external_out",
    });
    expect(
      context.raw
        .prepare(
          "SELECT reclassification_journal_entry_id AS id FROM import_transfer_resolutions WHERE import_row_id = ?",
        )
        .get(rowId),
    ).toEqual({ id: null });

    await finalizeImportBatch(batchId);

    expect((await getTransferClearingBalance()).amountMinor).toBe(0);
    expect((await getOutsideScopeTransferBalance()).amountMinor).toBe(1_000);
    const resolution = context.raw
      .prepare(
        "SELECT reclassification_journal_entry_id AS id FROM import_transfer_resolutions WHERE import_row_id = ?",
      )
      .get(rowId) as { id: number };
    expect(resolution.id).toBeGreaterThan(0);
    expect(
      (await listRecentJournalEntries()).find((entry) => entry.id === resolution.id)
        ?.importSource,
    ).toMatchObject({ importRowId: rowId, importBatchId: batchId });
  });

  it("reclassifies posted external transfers immediately and reverses them before changes", async () => {
    const accountId = await createFinancialAccount({
      name: "Posted outside-scope source",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10_000,
      requiredForClose: true,
    });
    const batchId = await commit(
      source({
        accountId,
        filename: "outside-scope-after-posting.csv",
        openingBalance: "100.00",
        closingBalance: "90.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-10,Transfer to retirement,-10.00,USD,transfer",
      }),
    );
    const [rowId] = importRowIds(batchId);
    await saveRowDecision({
      importRowId: rowId!,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    await finalizeImportBatch(batchId);
    expect((await getTransferClearingBalance()).amountMinor).toBe(1_000);

    await classifyTransfer({
      importRowId: rowId!,
      classification: "external_out",
    });

    const resolution = context.raw
      .prepare(
        "SELECT id, reclassification_journal_entry_id AS journalEntryId FROM import_transfer_resolutions WHERE import_row_id = ?",
      )
      .get(rowId) as { id: number; journalEntryId: number };
    expect((await getTransferClearingBalance()).amountMinor).toBe(0);
    expect((await getOutsideScopeTransferBalance()).amountMinor).toBe(1_000);
    await expect(
      reverseJournalEntry({
        journalEntryId: resolution.journalEntryId,
        reason: "Trying a direct reversal",
      }),
    ).rejects.toThrow("Change or clear the transfer resolution");
    expect(() =>
      context.raw
        .prepare("DELETE FROM import_transfer_resolutions WHERE id = ?")
        .run(resolution.id),
    ).toThrow("reverse the outside-scope transfer reclassification");

    await clearTransferClassification(rowId!);

    expect((await getTransferClearingBalance()).amountMinor).toBe(1_000);
    expect((await getOutsideScopeTransferBalance()).amountMinor).toBe(0);
    expect(
      context.raw
        .prepare(
          "SELECT count(*) AS count FROM journal_entries WHERE reverses_entry_id = ? AND is_posted = 1",
        )
        .get(resolution.journalEntryId),
    ).toEqual({ count: 1 });
  });

  it("rejects category types whose source direction contradicts their meaning", async () => {
    const accountId = await createFinancialAccount({
      name: "Direction checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10_000,
      requiredForClose: true,
    });
    const batchId = await commit(
      source({
        accountId,
        filename: "wrong-direction.csv",
        openingBalance: "100.00",
        closingBalance: "110.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-10,Positive expense,10.00,USD,expense",
      }),
    );
    const [rowId] = importRowIds(batchId);
    await expect(
      saveRowDecision({
        importRowId: rowId!,
        disposition: "accepted",
        confirmedType: "expense",
        allocations: [{ categoryId: expenseCategoryId, amountMinor: 1_000 }],
      }),
    ).rejects.toThrow("Expenses must be money leaving");
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO import_row_decisions
             (import_row_id, disposition, confirmed_type, effective_date)
           VALUES (?, 'accepted', 'expense', '2026-08-10')`,
        )
        .run(rowId),
    ).toThrow("transaction type does not match the source amount direction");
  });

  it("keeps unposted statements from disappearing into archived accounts", async () => {
    const accountId = await createFinancialAccount({
      name: "Closing account",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 0,
      requiredForClose: false,
    });
    const batchId = await commit(
      source({
        accountId,
        filename: "closing-account.csv",
        openingBalance: "0.00",
        closingBalance: "-10.00",
        csv: "transaction_date,description,amount,currency,type\n2026-08-10,Last transfer,-10.00,USD,transfer",
      }),
    );
    const [rowId] = importRowIds(batchId);
    await saveRowDecision({
      importRowId: rowId!,
      disposition: "accepted",
      confirmedType: "transfer",
    });

    await expect(archiveFinancialAccount(accountId, "2026-08-19")).rejects.toThrow(
      "Review, finalize, and post every imported statement",
    );
    context.raw
      .prepare(
        "UPDATE financial_accounts SET archived_at = CURRENT_TIMESTAMP, archived_on = '2026-08-19' WHERE id = ?",
      )
      .run(accountId);
    await expect(finalizeImportBatch(batchId)).rejects.toThrow(
      "Restore Closing account",
    );
  });

  it("reports cross-month pending coverage, gaps, and final completion", async () => {
    const accountId = await createFinancialAccount({
      name: "Irregular-cycle card",
      type: "credit_card",
      openingDate: "2026-07-16",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const insertBatch = context.raw.prepare(
      `INSERT INTO import_batches (
         financial_account_id, source_filename, file_checksum, csv_schema_version,
         currency, statement_start_date, statement_end_date,
         opening_balance_minor, closing_balance_minor, row_count, warning_count,
         validation_status, review_status, finalized_at, ledger_posted_at
       ) VALUES (?, ?, ?, 'csv-v1', 'USD', ?, ?, 0, 0, 1, 0, 'validated', ?, ?, ?)`,
    );
    insertBatch.run(
      accountId,
      "cycle-a.csv",
      "a".repeat(64),
      "2026-07-16",
      "2026-08-15",
      "finalized",
      "2026-08-16 00:00:00",
      "2026-08-16 00:00:00",
    );
    const pending = insertBatch.run(
      accountId,
      "cycle-b.csv",
      "b".repeat(64),
      "2026-08-16",
      "2026-09-15",
      "in_review",
      null,
      null,
    );

    expect(await getMonthCoverage("2026-08")).toMatchObject({
      requiredAccountCount: 1,
      completeAccountCount: 0,
      blockedAccountCount: 1,
      isCoverageComplete: false,
      accounts: [
        {
          status: "pending_finalization",
          gaps: [{ start: "2026-08-16", end: "2026-08-31" }],
        },
      ],
    });
    context.raw
      .prepare(
        `UPDATE import_batches
         SET review_status = 'finalized', finalized_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(Number(pending.lastInsertRowid));
    expect(await getMonthCoverage("2026-08")).toMatchObject({
      requiredAccountCount: 1,
      completeAccountCount: 1,
      blockedAccountCount: 0,
      isCoverageComplete: true,
      accounts: [{ status: "complete", gaps: [] }],
    });
  });
});
