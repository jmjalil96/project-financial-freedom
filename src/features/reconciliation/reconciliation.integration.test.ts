import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import { createFinancialAccount } from "@/features/accounts/account-service";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
} from "@/features/imports/import-service";
import { refreshDuplicateCandidatesForBatch } from "@/features/reconciliation/duplicate-detection-service";
import { finalizeImportBatch } from "@/features/reconciliation/finalization-service";
import { getStatementReconciliation } from "@/features/reconciliation/reconciliation-service";
import {
  dismissDuplicateCandidate,
  listReviewRowsForBatch,
  saveRowDecision,
} from "@/features/reconciliation/review-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../../test-fixtures/database-test-context";

const encoder = new TextEncoder();
let context: DatabaseContext;
let temporaryRoot: string;
let accountId: number;
let expenseCategoryIds: [number, number];
let incomeCategoryId: number;

function sourceInput(
  csv: string,
  overrides: Partial<ImportSourceInput> = {},
): ImportSourceInput {
  return {
    financialAccountId: accountId,
    statementStartDate: "2026-08-01",
    statementEndDate: "2026-08-31",
    openingBalance: "100.00",
    closingBalance: "90.00",
    sourceFilename: "statement.csv",
    bytes: encoder.encode(csv),
    ...overrides,
  };
}

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

function insertCategory(
  name: string,
  slug: string,
  kind: "income" | "expense",
): number {
  const result = context.raw
    .prepare("INSERT INTO categories (name, slug, kind) VALUES (?, ?, ?)")
    .run(name, slug, kind);
  const categoryId = Number(result.lastInsertRowid);
  context.raw
    .prepare("INSERT INTO ledger_accounts (name, kind, category_id) VALUES (?, ?, ?)")
    .run(name, kind, categoryId);
  return categoryId;
}

function rowsForBatch(batchId: number): Array<{
  id: number;
  original_row_number: number;
  amount_minor: number;
}> {
  return context.raw
    .prepare(
      `SELECT id, original_row_number, amount_minor
       FROM import_rows
       WHERE import_batch_id = ?
       ORDER BY original_row_number`,
    )
    .all(batchId) as Array<{
    id: number;
    original_row_number: number;
    amount_minor: number;
  }>;
}

async function acceptExpense(
  importRowId: number,
  amountMinor: number,
  categoryId = expenseCategoryIds[0],
): Promise<void> {
  await saveRowDecision({
    importRowId,
    disposition: "accepted",
    confirmedType: "expense",
    allocations: [{ categoryId, amountMinor }],
  });
}

async function createFinalizedDuplicateBatch(): Promise<{
  batchId: number;
  canonicalRowId: number;
  duplicateRowId: number;
  decisionId: number;
  allocationId: number;
  candidateId: number;
  finalizedAt: string;
}> {
  const batchId = await commit(
    sourceInput(
      [
        "transaction_date,description,amount,currency,external_id,type",
        "2026-08-04,Immutable duplicate,-10.00,USD,immutable-duplicate,expense",
        "2026-08-04,Immutable duplicate,-10.00,USD,immutable-duplicate,expense",
      ].join("\n"),
      {
        closingBalance: "90.00",
        sourceFilename: "immutable-finalized.csv",
      },
    ),
  );
  const [canonical, duplicate] = rowsForBatch(batchId);
  await acceptExpense(canonical!.id, 1_000);
  await saveRowDecision({
    importRowId: duplicate!.id,
    disposition: "duplicate",
    duplicateOfImportRowId: canonical!.id,
  });
  const finalized = await finalizeImportBatch(batchId);
  const decision = context.raw
    .prepare("SELECT id FROM import_row_decisions WHERE import_row_id = ?")
    .get(canonical!.id) as { id: number };
  const allocation = context.raw
    .prepare("SELECT id FROM import_row_category_allocations WHERE import_row_id = ?")
    .get(canonical!.id) as { id: number };
  const candidate = context.raw
    .prepare("SELECT id FROM import_duplicate_candidates WHERE import_row_id = ?")
    .get(duplicate!.id) as { id: number };

  return {
    batchId,
    canonicalRowId: canonical!.id,
    duplicateRowId: duplicate!.id,
    decisionId: decision.id,
    allocationId: allocation.id,
    candidateId: candidate.id,
    finalizedAt: finalized.finalizedAt,
  };
}

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase(
    "pff-reconciliation-test-",
  ));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
  accountId = await createFinancialAccount({
    name: "Checking",
    type: "checking",
    openingDate: "2026-07-01",
    openingBalanceMinor: 0,
    requiredForClose: true,
  });
  expenseCategoryIds = [
    insertCategory("Test Expense A", "test-expense-a", "expense"),
    insertCategory("Test Expense B", "test-expense-b", "expense"),
  ];
  incomeCategoryId = insertCategory("Test Income", "test-income", "income");
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 4 reconciliation services", () => {
  it("keeps source rows unchanged while exclusions require a reason and remove activity", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes",
          "2026-08-04,2026-08-05,Original source,-10.00,USD,source-1,Original Merchant,expense,Groceries,Original note",
        ].join("\n"),
        {
          closingBalance: "100.00",
          sourceFilename: "source-immutability.csv",
        },
      ),
    );
    const [row] = rowsForBatch(batchId);
    const before = context.raw
      .prepare("SELECT * FROM import_rows WHERE id = ?")
      .get(row!.id);

    await expect(
      saveRowDecision({
        importRowId: row!.id,
        disposition: "excluded",
        exclusionReason: "   ",
      }),
    ).rejects.toThrow("Explain why this source row is excluded.");
    expect(
      context.raw
        .prepare(
          "SELECT count(*) AS count FROM import_row_decisions WHERE import_row_id = ?",
        )
        .get(row!.id),
    ).toEqual({ count: 0 });

    await acceptExpense(row!.id, 1_000);
    await saveRowDecision({
      importRowId: row!.id,
      disposition: "excluded",
      exclusionReason: "Not statement account activity",
    });

    expect(
      context.raw.prepare("SELECT * FROM import_rows WHERE id = ?").get(row!.id),
    ).toEqual(before);
    expect((await getStatementReconciliation(batchId)).reconciliation).toEqual({
      openingBalanceMinor: 10_000,
      closingBalanceMinor: 10_000,
      sourceActivityTotalMinor: -1_000,
      provisionalActivityTotalMinor: 0,
      acceptedActivityTotalMinor: 0,
      expectedClosingBalanceMinor: 10_000,
      differenceMinor: 0,
    });
  });

  it("enforces exact positive expense and refund allocation totals and kinds", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-18,Split expense,-120.00,USD,expense",
          "2026-08-19,Split refund,20.00,USD,refund",
        ].join("\n"),
        { sourceFilename: "split-allocation-rules.csv" },
      ),
    );
    const [expenseRow, refundRow] = rowsForBatch(batchId);

    await expect(
      saveRowDecision({
        importRowId: expenseRow!.id,
        disposition: "accepted",
        confirmedType: "expense",
        allocations: [{ categoryId: incomeCategoryId, amountMinor: 12_000 }],
      }),
    ).rejects.toThrow("Choose an expense category.");
    await expect(
      saveRowDecision({
        importRowId: refundRow!.id,
        disposition: "accepted",
        confirmedType: "refund",
        allocations: [
          { categoryId: expenseCategoryIds[0], amountMinor: 1_500 },
          { categoryId: expenseCategoryIds[1], amountMinor: 499 },
        ],
      }),
    ).rejects.toThrow("Category allocations must equal the absolute source amount.");

    await saveRowDecision({
      importRowId: expenseRow!.id,
      disposition: "accepted",
      confirmedType: "expense",
      allocations: [
        { categoryId: expenseCategoryIds[0], amountMinor: 9_000 },
        { categoryId: expenseCategoryIds[1], amountMinor: 3_000 },
      ],
    });
    await saveRowDecision({
      importRowId: refundRow!.id,
      disposition: "accepted",
      confirmedType: "refund",
      allocations: [
        { categoryId: expenseCategoryIds[0], amountMinor: 1_500 },
        { categoryId: expenseCategoryIds[1], amountMinor: 500 },
      ],
    });

    const statement = await getStatementReconciliation(batchId);
    expect(statement.rows[0]!.decision.allocations).toEqual([
      expect.objectContaining({
        categoryId: expenseCategoryIds[0],
        categoryKind: "expense",
        amountMinor: 9_000,
      }),
      expect.objectContaining({
        categoryId: expenseCategoryIds[1],
        categoryKind: "expense",
        amountMinor: 3_000,
      }),
    ]);
    expect(statement.rows[1]!.decision.allocations).toEqual([
      expect.objectContaining({
        categoryId: expenseCategoryIds[0],
        categoryKind: "expense",
        amountMinor: 1_500,
      }),
      expect.objectContaining({
        categoryId: expenseCategoryIds[1],
        categoryKind: "expense",
        amountMinor: 500,
      }),
    ]);
  });

  it("requires a supporting note for an adjustment", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-20,Supported balance correction,5.00,USD,adjustment",
        ].join("\n"),
        {
          closingBalance: "105.00",
          sourceFilename: "adjustment-note.csv",
        },
      ),
    );
    const [row] = rowsForBatch(batchId);

    await expect(
      saveRowDecision({
        importRowId: row!.id,
        disposition: "accepted",
        confirmedType: "adjustment",
        reviewNote: "   ",
      }),
    ).rejects.toThrow("Explain the evidence supporting this adjustment.");
    await saveRowDecision({
      importRowId: row!.id,
      disposition: "accepted",
      confirmedType: "adjustment",
      reviewNote: "  Statement balance verified with the issuer.  ",
    });

    expect((await getStatementReconciliation(batchId)).rows[0]!.decision).toMatchObject(
      {
        confirmedType: "adjustment",
        reviewNote: "Statement balance verified with the issuer.",
        allocations: [],
      },
    );
  });

  it("classifies external-id, signature, and overlapping-statement candidate levels", async () => {
    await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-02,External anchor,-10.00,USD,level-external,expense",
          "2026-08-10,Signature Merchant,-11.00,USD,,expense",
          "2026-08-20,Overlap Merchant,-12.00,USD,,expense",
        ].join("\n"),
        { sourceFilename: "candidate-level-anchors.csv" },
      ),
    );
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-06,Different external description,-10.00,USD,level-external,expense",
          "2026-08-10,SIGNATURE MERCHANT,-11.00,USD,,expense",
          "2026-08-22,OVERLAP MERCHANT,-12.00,USD,,expense",
        ].join("\n"),
        { sourceFilename: "candidate-level-targets.csv" },
      ),
    );

    const candidates = context.raw
      .prepare(
        `SELECT row.amount_minor, candidate.match_kind, candidate.strength, candidate.status
         FROM import_duplicate_candidates AS candidate
         INNER JOIN import_rows AS row ON row.id = candidate.import_row_id
         WHERE row.import_batch_id = ?
         ORDER BY row.original_row_number`,
      )
      .all(batchId) as Array<{
      amount_minor: number;
      match_kind: string;
      strength: string;
      status: string;
    }>;

    expect(candidates).toEqual([
      {
        amount_minor: -1_000,
        match_kind: "external_id",
        strength: "strong",
        status: "open",
      },
      {
        amount_minor: -1_100,
        match_kind: "signature",
        strength: "weak",
        status: "open",
      },
      {
        amount_minor: -1_200,
        match_kind: "statement_overlap",
        strength: "weak",
        status: "open",
      },
    ]);
  });

  it("allows legitimate identical events after both are accepted and the candidate is dismissed", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Two legitimate coffees,-10.00,USD,expense",
          "2026-08-04,Two legitimate coffees,-10.00,USD,expense",
        ].join("\n"),
        {
          closingBalance: "80.00",
          sourceFilename: "legitimate-identical.csv",
        },
      ),
    );
    const [first, second] = rowsForBatch(batchId);
    const candidate = context.raw
      .prepare(
        "SELECT id FROM import_duplicate_candidates WHERE import_row_id = ? AND candidate_import_row_id = ?",
      )
      .get(second!.id, first!.id) as { id: number };

    await acceptExpense(first!.id, 1_000);
    await acceptExpense(second!.id, 1_000);
    await dismissDuplicateCandidate(candidate.id);
    expect(
      context.raw
        .prepare("SELECT status FROM import_duplicate_candidates WHERE id = ?")
        .get(candidate.id),
    ).toEqual({ status: "dismissed" });

    await expect(finalizeImportBatch(batchId)).resolves.toMatchObject({
      acceptedCount: 2,
      acceptedActivityTotalMinor: -2_000,
      differenceMinor: 0,
    });
  });

  it("requires duplicate canonicals to be accepted and from the same account", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-04,Canonical event,-10.00,USD,canonical-1,expense",
          "2026-08-04,Canonical event,-10.00,USD,canonical-1,expense",
        ].join("\n"),
        { sourceFilename: "canonical-rules.csv" },
      ),
    );
    const [canonical, duplicate] = rowsForBatch(batchId);
    const otherAccountId = await createFinancialAccount({
      name: "Savings",
      type: "savings",
      openingDate: "2026-07-01",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const otherBatchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Other account event,5.00,USD,transfer",
        ].join("\n"),
        {
          financialAccountId: otherAccountId,
          openingBalance: "0.00",
          closingBalance: "5.00",
          sourceFilename: "other-account-canonical.csv",
        },
      ),
    );
    const [otherRow] = rowsForBatch(otherBatchId);
    await saveRowDecision({
      importRowId: otherRow!.id,
      disposition: "accepted",
      confirmedType: "transfer",
    });

    await expect(
      saveRowDecision({
        importRowId: duplicate!.id,
        disposition: "duplicate",
        duplicateOfImportRowId: canonical!.id,
      }),
    ).rejects.toThrow("The canonical duplicate row must be accepted.");
    await expect(
      saveRowDecision({
        importRowId: duplicate!.id,
        disposition: "duplicate",
        duplicateOfImportRowId: otherRow!.id,
      }),
    ).rejects.toThrow("same account");

    await acceptExpense(canonical!.id, 1_000);
    await saveRowDecision({
      importRowId: duplicate!.id,
      disposition: "duplicate",
      duplicateOfImportRowId: canonical!.id,
    });
    expect(
      context.raw
        .prepare(
          "SELECT disposition, duplicate_of_import_row_id FROM import_row_decisions WHERE import_row_id = ?",
        )
        .get(duplicate!.id),
    ).toEqual({
      disposition: "duplicate",
      duplicate_of_import_row_id: canonical!.id,
    });
  });

  it("reopens a confirmed candidate when its duplicate decision changes", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-04,Decision changes,-10.00,USD,reopen-1,expense",
          "2026-08-04,Decision changes,-10.00,USD,reopen-1,expense",
        ].join("\n"),
        { sourceFilename: "candidate-reopen.csv" },
      ),
    );
    const [canonical, duplicate] = rowsForBatch(batchId);
    const candidate = context.raw
      .prepare(
        "SELECT id FROM import_duplicate_candidates WHERE import_row_id = ? AND candidate_import_row_id = ?",
      )
      .get(duplicate!.id, canonical!.id) as { id: number };

    await acceptExpense(canonical!.id, 1_000);
    await saveRowDecision({
      importRowId: duplicate!.id,
      disposition: "duplicate",
      duplicateOfImportRowId: canonical!.id,
    });
    expect(
      context.raw
        .prepare("SELECT status FROM import_duplicate_candidates WHERE id = ?")
        .get(candidate.id),
    ).toEqual({ status: "confirmed" });

    await acceptExpense(duplicate!.id, 1_000, expenseCategoryIds[1]);
    expect(
      context.raw
        .prepare("SELECT status FROM import_duplicate_candidates WHERE id = ?")
        .get(candidate.id),
    ).toEqual({ status: "open" });
  });

  it("audits old and new decision details and advances a pending batch to in-review", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Audited decision,-10.00,USD,expense",
        ].join("\n"),
        { sourceFilename: "decision-audit.csv" },
      ),
    );
    const [row] = rowsForBatch(batchId);
    expect(
      context.raw
        .prepare("SELECT review_status FROM import_batches WHERE id = ?")
        .get(batchId),
    ).toEqual({ review_status: "pending" });

    await saveRowDecision({
      importRowId: row!.id,
      disposition: "accepted",
      confirmedType: "expense",
      effectiveDate: "2026-08-06",
      normalizedMerchant: "  Audited Merchant  ",
      reviewNote: "  Initially accepted  ",
      allocations: [{ categoryId: expenseCategoryIds[0], amountMinor: 1_000 }],
    });
    expect(
      context.raw
        .prepare("SELECT review_status FROM import_batches WHERE id = ?")
        .get(batchId),
    ).toEqual({ review_status: "in_review" });
    await saveRowDecision({
      importRowId: row!.id,
      disposition: "excluded",
      exclusionReason: "  Outside statement activity  ",
    });

    const audits = context.raw
      .prepare(
        `SELECT details_json
         FROM audit_events
         WHERE action = 'review.row_decision_saved' AND entity_id = ?
         ORDER BY id`,
      )
      .all(String(row!.id)) as Array<{ details_json: string }>;
    expect(audits).toHaveLength(2);
    expect(JSON.parse(audits[0]!.details_json)).toEqual({
      batchId,
      clearedTransferResolutions: [],
      old: null,
      new: {
        disposition: "accepted",
        confirmedType: "expense",
        effectiveDate: "2026-08-06",
        normalizedMerchant: "Audited Merchant",
        reviewNote: "Initially accepted",
        exclusionReason: null,
        duplicateOfImportRowId: null,
        allocations: [
          {
            categoryId: expenseCategoryIds[0],
            categoryKind: "expense",
            amountMinor: 1_000,
          },
        ],
      },
    });
    expect(JSON.parse(audits[1]!.details_json)).toEqual({
      batchId,
      clearedTransferResolutions: [],
      old: {
        disposition: "accepted",
        confirmedType: "expense",
        effectiveDate: "2026-08-06",
        normalizedMerchant: "Audited Merchant",
        reviewNote: "Initially accepted",
        exclusionReason: null,
        duplicateOfImportRowId: null,
        allocations: [{ categoryId: expenseCategoryIds[0], amountMinor: 1_000 }],
      },
      new: {
        disposition: "excluded",
        confirmedType: null,
        effectiveDate: null,
        normalizedMerchant: null,
        reviewNote: null,
        exclusionReason: "Outside statement activity",
        duplicateOfImportRowId: null,
        allocations: [],
      },
    });
  });

  it("blocks finalization for an exact one-minor-unit mismatch", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Exact mismatch,-10.00,USD,expense",
        ].join("\n"),
        {
          closingBalance: "90.01",
          sourceFilename: "one-cent-mismatch.csv",
        },
      ),
    );
    const [row] = rowsForBatch(batchId);
    await acceptExpense(row!.id, 1_000);

    await expect(finalizeImportBatch(batchId)).rejects.toThrow(
      "reconciliation difference of 1 minor units",
    );
    expect(
      context.raw
        .prepare("SELECT review_status, finalized_at FROM import_batches WHERE id = ?")
        .get(batchId),
    ).toEqual({ review_status: "in_review", finalized_at: null });
  });

  it("reconciles liability balances with their normalized signed values", async () => {
    const cardId = await createFinancialAccount({
      name: "Visa",
      type: "credit_card",
      openingDate: "2026-07-01",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Card purchase,-60.00,USD,expense",
          "2026-08-10,Payment received,200.00,USD,transfer",
          "2026-08-12,Merchant refund,20.00,USD,refund",
        ].join("\n"),
        {
          financialAccountId: cardId,
          openingBalance: "400.00",
          closingBalance: "240.00",
          sourceFilename: "liability-signed-reconciliation.csv",
        },
      ),
    );
    const [purchase, payment, refund] = rowsForBatch(batchId);
    await acceptExpense(purchase!.id, 6_000);
    await saveRowDecision({
      importRowId: payment!.id,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    await saveRowDecision({
      importRowId: refund!.id,
      disposition: "accepted",
      confirmedType: "refund",
      allocations: [{ categoryId: expenseCategoryIds[0], amountMinor: 2_000 }],
    });

    const statement = await getStatementReconciliation(batchId);
    expect(statement.account).toMatchObject({ id: cardId, type: "credit_card" });
    expect(statement.reconciliation).toEqual({
      openingBalanceMinor: -40_000,
      closingBalanceMinor: -24_000,
      sourceActivityTotalMinor: 16_000,
      provisionalActivityTotalMinor: 16_000,
      acceptedActivityTotalMinor: 16_000,
      expectedClosingBalanceMinor: -24_000,
      differenceMinor: 0,
    });
    await expect(finalizeImportBatch(batchId)).resolves.toMatchObject({
      acceptedCount: 3,
      differenceMinor: 0,
    });
  });

  it("atomically returns, posts, and audits a finalization receipt", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-04,Canonical coffee,-10.00,USD,receipt-duplicate,expense",
          "2026-08-04,Canonical coffee,-10.00,USD,receipt-duplicate,expense",
          "2026-08-05,Excluded evidence,-5.00,USD,receipt-excluded,expense",
        ].join("\n"),
        {
          closingBalance: "90.00",
          sourceFilename: "finalization-receipt.csv",
        },
      ),
    );
    const [canonical, duplicate, excluded] = rowsForBatch(batchId);
    await acceptExpense(canonical!.id, 1_000);
    await saveRowDecision({
      importRowId: duplicate!.id,
      disposition: "duplicate",
      duplicateOfImportRowId: canonical!.id,
    });
    await saveRowDecision({
      importRowId: excluded!.id,
      disposition: "excluded",
      exclusionReason: "Not account activity",
    });

    const receipt = await finalizeImportBatch(batchId);
    expect(receipt).toEqual({
      batchId,
      finalizedAt: expect.any(String),
      ledgerPostedAt: expect.any(String),
      journalEntryCount: 1,
      rowCount: 3,
      acceptedCount: 1,
      excludedCount: 1,
      duplicateCount: 1,
      sourceActivityTotalMinor: -2_500,
      acceptedActivityTotalMinor: -1_000,
      differenceMinor: 0,
    });
    expect(
      context.raw
        .prepare(
          "SELECT review_status, finalized_at, ledger_posted_at FROM import_batches WHERE id = ?",
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
          "SELECT count(*) AS count FROM journal_entries WHERE source_type = 'import'",
        )
        .get(),
    ).toEqual({ count: 1 });

    const audit = context.raw
      .prepare(
        "SELECT details_json FROM audit_events WHERE action = 'review.batch_finalized' AND entity_id = ?",
      )
      .get(String(batchId)) as { details_json: string };
    expect(JSON.parse(audit.details_json)).toMatchObject({
      rowCount: 3,
      acceptedCount: 1,
      excludedCount: 1,
      duplicateCount: 1,
      sourceActivityTotalMinor: -2_500,
      acceptedActivityTotalMinor: -1_000,
      differenceMinor: 0,
      finalizedAt: receipt.finalizedAt,
      ledgerPostedAt: receipt.ledgerPostedAt,
      journalEntryCount: 1,
    });
  });

  it("blocks every decision, allocation, and candidate raw mutation after finalization", async () => {
    const finalized = await createFinalizedDuplicateBatch();

    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO import_row_decisions
             (import_row_id, disposition, confirmed_type, effective_date)
           VALUES (?, 'accepted', 'transfer', '2026-08-04')`,
        )
        .run(finalized.canonicalRowId),
    ).toThrow("finalized import batch decisions are immutable");
    expect(() =>
      context.raw
        .prepare("UPDATE import_row_decisions SET review_note = 'changed' WHERE id = ?")
        .run(finalized.decisionId),
    ).toThrow("finalized import batch decisions are immutable");
    expect(() =>
      context.raw
        .prepare("DELETE FROM import_row_decisions WHERE id = ?")
        .run(finalized.decisionId),
    ).toThrow("finalized import batch decisions are immutable");

    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO import_row_category_allocations
             (import_row_decision_id, import_row_id, category_id, amount_minor)
           VALUES (?, ?, ?, 1)`,
        )
        .run(finalized.decisionId, finalized.canonicalRowId, expenseCategoryIds[1]),
    ).toThrow("finalized import batch category allocations are immutable");
    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_row_category_allocations SET amount_minor = 999 WHERE id = ?",
        )
        .run(finalized.allocationId),
    ).toThrow("finalized import batch category allocations are immutable");
    expect(() =>
      context.raw
        .prepare("DELETE FROM import_row_category_allocations WHERE id = ?")
        .run(finalized.allocationId),
    ).toThrow("finalized import batch category allocations are immutable");

    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO import_duplicate_candidates
             (import_row_id, candidate_import_row_id, match_kind, strength)
           VALUES (?, ?, 'signature', 'weak')`,
        )
        .run(finalized.canonicalRowId, finalized.duplicateRowId),
    ).toThrow("finalized import batch duplicate candidates are immutable");
    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_duplicate_candidates SET status = 'dismissed' WHERE id = ?",
        )
        .run(finalized.candidateId),
    ).toThrow("finalized import batch duplicate candidates are immutable");
    expect(() =>
      context.raw
        .prepare("DELETE FROM import_duplicate_candidates WHERE id = ?")
        .run(finalized.candidateId),
    ).toThrow("finalized import batch duplicate candidates are immutable");
  });

  it("prevents a finalized batch from reopening or changing its timestamp", async () => {
    const finalized = await createFinalizedDuplicateBatch();

    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_batches SET review_status = 'pending', finalized_at = NULL WHERE id = ?",
        )
        .run(finalized.batchId),
    ).toThrow("only finalized import batches can be posted to the ledger");
    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_batches SET finalized_at = '2099-01-01T00:00:00.000Z' WHERE id = ?",
        )
        .run(finalized.batchId),
    ).toThrow("finalized import batches cannot be reopened or retimestamped");
    expect(
      context.raw
        .prepare("SELECT review_status, finalized_at FROM import_batches WHERE id = ?")
        .get(finalized.batchId),
    ).toEqual({
      review_status: "finalized",
      finalized_at: finalized.finalizedAt,
    });
  });

  it("locks a cross-batch canonical row after a dependent statement finalizes", async () => {
    const anchorBatchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-01,Canonical source,-10.00,USD,cross-batch-lock,expense",
        ].join("\n"),
        {
          closingBalance: "90.00",
          sourceFilename: "canonical-lock-anchor.csv",
        },
      ),
    );
    const targetBatchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-02,Duplicate source,-10.00,USD,cross-batch-lock,expense",
        ].join("\n"),
        {
          closingBalance: "100.00",
          sourceFilename: "canonical-lock-target.csv",
        },
      ),
    );
    const [canonical] = rowsForBatch(anchorBatchId);
    const [duplicate] = rowsForBatch(targetBatchId);
    await acceptExpense(canonical!.id, 1_000);
    await saveRowDecision({
      importRowId: duplicate!.id,
      disposition: "duplicate",
      duplicateOfImportRowId: canonical!.id,
    });
    await finalizeImportBatch(targetBatchId);

    await expect(
      saveRowDecision({
        importRowId: canonical!.id,
        disposition: "excluded",
        exclusionReason: "Attempted replacement",
      }),
    ).rejects.toThrow("must remain accepted");
    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_row_decisions SET disposition = 'excluded', exclusion_reason = 'raw' WHERE import_row_id = ?",
        )
        .run(canonical!.id),
    ).toThrow("canonical rows referenced by finalized batches must remain accepted");
    expect((await getStatementReconciliation(targetBatchId)).batchBlockers).toEqual([]);
  });

  it("rejects review effective dates before the account opening date", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Opening floor,-10.00,USD,expense",
        ].join("\n"),
        { sourceFilename: "opening-floor.csv" },
      ),
    );
    const [row] = rowsForBatch(batchId);

    await expect(
      saveRowDecision({
        importRowId: row!.id,
        disposition: "accepted",
        confirmedType: "expense",
        effectiveDate: "1999-01-01",
        allocations: [{ categoryId: expenseCategoryIds[0], amountMinor: 1_000 }],
      }),
    ).rejects.toThrow("account opening date");
  });

  it("rejects the unsupported earlier-to-later duplicate direction", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-04,Earlier source,-10.00,USD,direction-test,expense",
          "2026-08-04,Later source,-10.00,USD,direction-test,expense",
        ].join("\n"),
        {
          closingBalance: "90.00",
          sourceFilename: "duplicate-direction.csv",
        },
      ),
    );
    const [earlier, later] = rowsForBatch(batchId);
    await acceptExpense(later!.id, 1_000);

    await expect(
      saveRowDecision({
        importRowId: earlier!.id,
        disposition: "duplicate",
        duplicateOfImportRowId: later!.id,
      }),
    ).rejects.toThrow("later import row must point to the earlier canonical row");
  });

  it("uses row-level readiness for accepted rows with open candidates", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-04,Ready canonical,-10.00,USD,row-ready,expense",
          "2026-08-04,Open candidate,-10.00,USD,row-ready,expense",
        ].join("\n"),
        {
          closingBalance: "80.00",
          sourceFilename: "row-readiness.csv",
        },
      ),
    );
    const [canonical, candidateOwner] = rowsForBatch(batchId);
    await acceptExpense(canonical!.id, 1_000);
    await acceptExpense(candidateOwner!.id, 1_000);
    const rows = await listReviewRowsForBatch(batchId);
    const owner = rows.find((row) => row.id === candidateOwner!.id)!;

    expect(owner.inboxFilters).toContain("suspected_duplicate");
    expect(owner.inboxFilters).not.toContain("ready_to_finalize");
    expect(
      (await getStatementReconciliation(batchId)).rows.find(
        (row) => row.id === owner.id,
      )!.blockers,
    ).toEqual(owner.blockers);
  });

  it("fails closed for raw invalid review decisions", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency",
          "2026-08-04,Null reason,-1.00,USD",
          "2026-08-05,Invalid date,-1.00,USD",
        ].join("\n"),
        { sourceFilename: "raw-decision-guards.csv" },
      ),
    );
    const [excludedRow, acceptedRow] = rowsForBatch(batchId);

    expect(() =>
      context.raw
        .prepare(
          "INSERT INTO import_row_decisions (import_row_id, disposition, exclusion_reason) VALUES (?, 'excluded', NULL)",
        )
        .run(excludedRow!.id),
    ).toThrow();
    expect(() =>
      context.raw
        .prepare(
          "INSERT INTO import_row_decisions (import_row_id, disposition, confirmed_type, effective_date) VALUES (?, 'accepted', 'expense', '2024-13-01')",
        )
        .run(acceptedRow!.id),
    ).toThrow();
  });

  it("blocks finalization when a saved allocation category is later archived", async () => {
    const batchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,type",
          "2026-08-04,Archived category expense,-10.00,USD,expense",
        ].join("\n"),
        {
          closingBalance: "90.00",
          sourceFilename: "archived-category-finalize.csv",
        },
      ),
    );
    const [row] = rowsForBatch(batchId);
    await acceptExpense(row!.id, 1_000);
    context.raw
      .prepare("UPDATE categories SET archived_at = ? WHERE id = ?")
      .run("2026-08-19T12:00:00.000Z", expenseCategoryIds[0]);
    await expect(acceptExpense(row!.id, 1_000)).rejects.toThrow(
      "Choose only active categories",
    );
    expect(
      context.raw
        .prepare(
          "SELECT category_id FROM import_row_category_allocations WHERE import_row_id = ?",
        )
        .get(row!.id),
    ).toEqual({ category_id: expenseCategoryIds[0] });

    const statement = await getStatementReconciliation(batchId);
    expect(statement.batchBlockers).toContainEqual({
      code: "inactive_categories",
      message: "Replace archived category allocations before finalizing.",
      categoryIds: [expenseCategoryIds[0]],
    });
    await expect(finalizeImportBatch(batchId)).rejects.toThrow(
      "Test Expense A is archived",
    );
    expect(
      context.raw
        .prepare("SELECT review_status, finalized_at FROM import_batches WHERE id = ?")
        .get(batchId),
    ).toEqual({ review_status: "in_review", finalized_at: null });
  });

  it("preserves dismissed and confirmed candidate statuses during refresh", async () => {
    const anchorBatchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-01,Dismiss anchor,-10.00,USD,dismiss-me,expense",
          "2026-08-02,Confirm anchor,-20.00,USD,confirm-me,expense",
        ].join("\n"),
        { sourceFilename: "candidate-status-anchors.csv" },
      ),
    );
    const targetBatchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-05,Dismiss target,-10.00,USD,dismiss-me,expense",
          "2026-08-06,Confirm target,-20.00,USD,confirm-me,expense",
        ].join("\n"),
        { sourceFilename: "candidate-status-targets.csv" },
      ),
    );
    const [, confirmAnchor] = rowsForBatch(anchorBatchId);
    const [dismissTarget, confirmTarget] = rowsForBatch(targetBatchId);
    const candidates = context.raw
      .prepare(
        `SELECT candidate.id, row.external_id
         FROM import_duplicate_candidates AS candidate
         INNER JOIN import_rows AS row ON row.id = candidate.import_row_id
         WHERE row.import_batch_id = ?`,
      )
      .all(targetBatchId) as Array<{ id: number; external_id: string }>;
    const candidateByExternalId = new Map(
      candidates.map((candidate) => [candidate.external_id, candidate.id]),
    );

    await dismissDuplicateCandidate(candidateByExternalId.get("dismiss-me")!);
    await acceptExpense(confirmAnchor!.id, 2_000);
    await saveRowDecision({
      importRowId: confirmTarget!.id,
      disposition: "duplicate",
      duplicateOfImportRowId: confirmAnchor!.id,
    });
    expect(dismissTarget).toBeDefined();

    const refresh = context.db.transaction((transaction) =>
      refreshDuplicateCandidatesForBatch(transaction, targetBatchId),
    );
    expect(refresh).toMatchObject({
      batchId: targetBatchId,
      createdCount: 0,
      updatedCount: 0,
      candidateCount: 2,
    });
    expect(
      context.raw
        .prepare(
          `SELECT row.external_id, candidate.status
           FROM import_duplicate_candidates AS candidate
           INNER JOIN import_rows AS row ON row.id = candidate.import_row_id
           WHERE row.import_batch_id = ?
           ORDER BY row.external_id`,
        )
        .all(targetBatchId),
    ).toEqual([
      { external_id: "confirm-me", status: "confirmed" },
      { external_id: "dismiss-me", status: "dismissed" },
    ]);
  });

  it("lazily backfills duplicate candidates for statements committed before review", async () => {
    await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-01,Legacy anchor,-10.00,USD,legacy-match,expense",
        ].join("\n"),
        { sourceFilename: "legacy-anchor.csv" },
      ),
    );
    const targetBatchId = await commit(
      sourceInput(
        [
          "transaction_date,description,amount,currency,external_id,type",
          "2026-08-02,Legacy target,-10.00,USD,legacy-match,expense",
        ].join("\n"),
        { sourceFilename: "legacy-target.csv" },
      ),
    );
    context.raw
      .prepare(
        `DELETE FROM import_duplicate_candidates
         WHERE import_row_id IN (
           SELECT id FROM import_rows WHERE import_batch_id = ?
         )`,
      )
      .run(targetBatchId);
    context.raw
      .prepare("UPDATE import_batches SET duplicate_scan_version = 0 WHERE id = ?")
      .run(targetBatchId);

    expect(
      (await getStatementReconciliation(targetBatchId)).rows[0]?.duplicateCandidates,
    ).toEqual([]);
    const [targetRow] = rowsForBatch(targetBatchId);
    await acceptExpense(targetRow!.id, 1_000);
    const statement = await getStatementReconciliation(targetBatchId);

    expect(statement.rows[0]?.duplicateCandidates).toEqual([
      expect.objectContaining({
        matchKind: "external_id",
        status: "open",
      }),
    ]);
    expect(
      context.raw
        .prepare("SELECT duplicate_scan_version FROM import_batches WHERE id = ?")
        .get(targetBatchId),
    ).toEqual({ duplicate_scan_version: 1 });
  });

  it("loads more rows than SQLite permits in one parameter list", async () => {
    const rowCount = 32_800;
    const batch = context.raw
      .prepare(
        `INSERT INTO import_batches (
           financial_account_id, source_filename, file_checksum, csv_schema_version,
           currency, statement_start_date, statement_end_date,
           opening_balance_minor, closing_balance_minor, row_count, warning_count,
           validation_status, review_status, is_sealed
         ) VALUES (?, ?, ?, 'csv-v1', 'USD', '2026-08-01', '2026-08-31',
           0, 0, ?, 0, 'validated', 'pending', 0)`,
      )
      .run(accountId, "sqlite-variable-limit.csv", "f".repeat(64), rowCount);
    const batchId = Number(batch.lastInsertRowid);
    context.raw
      .prepare(
        `WITH RECURSIVE numbers(value) AS (
           SELECT 1
           UNION ALL
           SELECT value + 1 FROM numbers WHERE value < ?
         )
         INSERT INTO import_rows (
           import_batch_id, original_row_number, transaction_date, description,
           amount_minor, currency, default_effective_date, normalized_fingerprint,
           validation_status, review_status, warnings_json
         )
         SELECT ?, value + 1, '2026-08-01', 'Scale row ' || value,
           value, 'USD', '2026-08-01', printf('%064d', value),
           'valid', 'unresolved', '[]'
         FROM numbers`,
      )
      .run(rowCount, batchId);
    context.raw
      .prepare("UPDATE import_batches SET is_sealed = 1 WHERE id = ?")
      .run(batchId);

    expect((await listReviewRowsForBatch(batchId)).length).toBe(rowCount);
  });
});
