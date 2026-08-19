import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import { createFinancialAccount } from "@/features/accounts/account-service";
import { createCategory } from "@/features/categories/category-service";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
} from "@/features/imports/import-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../../test-fixtures/database-test-context";

const encoder = new TextEncoder();
let context: DatabaseContext;
let temporaryRoot: string;
let checkingAccountId: number;

function sourceInput(
  csv: string,
  overrides: Partial<ImportSourceInput> = {},
): ImportSourceInput {
  return {
    financialAccountId: checkingAccountId,
    statementStartDate: "2026-08-01",
    statementEndDate: "2026-08-31",
    openingBalance: "1000.00",
    closingBalance: "905.55",
    sourceFilename: "august-checking.csv",
    bytes: encoder.encode(csv),
    ...overrides,
  };
}

async function commitPreviewedImport(input: ImportSourceInput) {
  const validation = await validateImportSource(input);

  if (validation.status === "invalid") {
    return validation;
  }

  return commitValidatedImport(input, validation.preview.approvalToken);
}

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-import-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
  checkingAccountId = await createFinancialAccount({
    name: "Checking",
    type: "checking",
    openingDate: "2026-07-31",
    openingBalanceMinor: 0,
    requiredForClose: true,
  });
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 3 import pipeline", () => {
  it("previews every normalized row and retains unresolved warnings", async () => {
    const csv = [
      "transaction_date,posted_date,description,amount,currency,external_id,merchant,type,category,notes",
      "2026-08-04,2026-08-05,WHOLE FOODS,-82.45,USD,TX-1,Whole Foods,expense,Groceries,",
      "2026-09-01,2026-09-02,UNKNOWN SHOP,-12.00,USD,TX-2,,expense,Imaginary,Category uncertain",
    ].join("\n");
    const result = await validateImportSource(sourceInput(csv));

    expect(result.status).toBe("ready");

    if (result.status !== "ready") {
      return;
    }

    expect(result.preview.rows).toHaveLength(2);
    expect(result.preview.rows[0]).toMatchObject({
      originalRowNumber: 2,
      amountMinor: -8245,
      defaultEffectiveDate: "2026-08-05",
      suggestedCategoryId: expect.any(Number),
      warnings: [],
    });
    expect(result.preview.rows[1]?.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "transaction_date_outside_statement",
        "posted_date_outside_statement",
        "unknown_category",
        "description_uncertainty",
        "source_uncertainty",
      ]),
    );
    expect(result.preview.statement.differenceMinor).toBe(0);
  });

  it("matches category suggestions through the Unicode-aware canonical key", async () => {
    const cafeId = await createCategory({
      name: "Café",
      kind: "expense",
    });
    const unicodeId = await createCategory({
      name: "食品",
      kind: "expense",
    });
    const csv = [
      "transaction_date,description,amount,currency,type,category",
      "2026-08-04,COFFEE,-5.00,USD,expense,Cafe",
      "2026-08-05,MARKET,-10.00,USD,expense,食品",
    ].join("\n");
    const result = await validateImportSource(sourceInput(csv));

    expect(result.status).toBe("ready");

    if (result.status === "ready") {
      expect(result.preview.rows.map((row) => row.suggestedCategoryId)).toEqual([
        cafeId,
        unicodeId,
      ]);
    }
  });

  it("commits all source rows atomically without creating ledger entries", async () => {
    const csv = [
      "transaction_date,description,amount,currency,type,category",
      "2026-08-04,WHOLE FOODS,-82.45,USD,expense,Groceries",
      "2026-08-06,CAFE,-12.00,USD,expense,Imaginary",
    ].join("\n");
    const input = sourceInput(csv);
    const result = await commitPreviewedImport(input);
    const batchCount = context.raw
      .prepare("SELECT count(*) AS count FROM import_batches")
      .get() as { count: number };
    const sourceRows = context.raw
      .prepare(
        `SELECT original_row_number, description, amount_minor, suggested_category,
                suggested_category_id, review_status
         FROM import_rows
         ORDER BY original_row_number`,
      )
      .all();
    const importedJournals = context.raw
      .prepare(
        "SELECT count(*) AS count FROM journal_entries WHERE source_type = 'import'",
      )
      .get() as { count: number };
    const audit = context.raw
      .prepare("SELECT action FROM audit_events WHERE entity_type = 'import_batch'")
      .get() as { action: string };

    expect(result).toMatchObject({
      status: "committed",
      rowCount: 2,
    });
    expect(batchCount.count).toBe(1);
    expect(sourceRows).toEqual([
      {
        original_row_number: 2,
        description: "WHOLE FOODS",
        amount_minor: -8245,
        suggested_category: "Groceries",
        suggested_category_id: expect.any(Number),
        review_status: "unresolved",
      },
      {
        original_row_number: 3,
        description: "CAFE",
        amount_minor: -1200,
        suggested_category: "Imaginary",
        suggested_category_id: null,
        review_status: "unresolved",
      },
    ]);
    expect(importedJournals.count).toBe(0);
    expect(audit.action).toBe("import.committed");
  });

  it("commits the advertised 5,000-row maximum in bounded SQL batches", async () => {
    const rows = Array.from(
      { length: 5_000 },
      (_, index) => `2026-08-01,ROW ${index + 1},0.01,USD`,
    );
    const input = sourceInput(
      ["transaction_date,description,amount,currency", ...rows].join("\n"),
      {
        openingBalance: "0.00",
        closingBalance: "50.00",
        sourceFilename: "maximum-size-import.csv",
      },
    );

    const result = await commitPreviewedImport(input);
    const rowCount = context.raw
      .prepare("SELECT count(*) AS count FROM import_rows")
      .get() as { count: number };

    expect(result).toMatchObject({ status: "committed", rowCount: 5_000 });
    expect(rowCount.count).toBe(5_000);
  });

  it("binds commit approval to the exact previewed source and metadata", async () => {
    const csv = [
      "transaction_date,description,amount,currency",
      "2026-08-04,WHOLE FOODS,-82.45,USD",
    ].join("\n");
    const original = sourceInput(csv, { closingBalance: "917.55" });
    const validation = await validateImportSource(original);

    expect(validation.status).toBe("ready");

    if (validation.status !== "ready") {
      return;
    }

    const changed = {
      ...original,
      closingBalance: "900.00",
    };
    const result = await commitValidatedImport(
      changed,
      validation.preview.approvalToken,
    );

    expect(result).toMatchObject({
      status: "invalid",
      errors: [expect.objectContaining({ code: "stale_preview" })],
    });
    expect(
      (
        context.raw.prepare("SELECT count(*) AS count FROM import_batches").get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
  });

  it("blocks statements that begin before the account opening date", async () => {
    const newerAccountId = await createFinancialAccount({
      name: "New account",
      type: "checking",
      openingDate: "2026-08-10",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const csv = [
      "transaction_date,description,amount,currency",
      "2026-08-11,DEPOSIT,10.00,USD",
    ].join("\n");
    const result = await validateImportSource(
      sourceInput(csv, {
        financialAccountId: newerAccountId,
        closingBalance: "1010.00",
      }),
    );

    expect(result).toMatchObject({
      status: "invalid",
      errors: [expect.objectContaining({ code: "statement_before_account_opening" })],
    });
  });

  it("reports an invalid account identifier only once", async () => {
    const csv = [
      "transaction_date,description,amount,currency",
      "2026-08-11,DEPOSIT,10.00,USD",
    ].join("\n");
    const result = await validateImportSource(
      sourceInput(csv, {
        financialAccountId: Number.NaN,
      }),
    );

    expect(result.status).toBe("invalid");

    if (result.status === "invalid") {
      expect(
        result.errors.filter((error) => error.code === "invalid_account"),
      ).toHaveLength(1);
    }
  });

  it("rolls back the batch when a row insert fails after writing begins", async () => {
    const csv = [
      "transaction_date,description,amount,currency",
      "2026-08-04,VALID ROW,-82.45,USD",
      "2026-08-05,SECOND VALID ROW,-10.00,USD",
    ].join("\n");
    context.raw.exec(`
      CREATE TRIGGER test_fail_second_import_row
      BEFORE INSERT ON import_rows
      WHEN NEW.original_row_number = 3
      BEGIN
        SELECT RAISE(ABORT, 'injected row failure');
      END
    `);

    await expect(commitPreviewedImport(sourceInput(csv))).rejects.toThrow(
      "injected row failure",
    );
    const batchCount = context.raw
      .prepare("SELECT count(*) AS count FROM import_batches")
      .get() as { count: number };
    const rowCount = context.raw
      .prepare("SELECT count(*) AS count FROM import_rows")
      .get() as { count: number };

    expect(batchCount.count).toBe(0);
    expect(rowCount.count).toBe(0);
  });

  it("blocks an exact re-upload and warns on normalized rows in a changed file", async () => {
    const lfCsv = [
      "transaction_date,description,amount,currency",
      "2026-08-04,WHOLE FOODS,-82.45,USD",
    ].join("\n");
    const firstInput = sourceInput(lfCsv, {
      closingBalance: "917.55",
    });

    expect((await commitPreviewedImport(firstInput)).status).toBe("committed");

    const exactResult = await validateImportSource(firstInput);
    expect(exactResult).toMatchObject({
      status: "invalid",
      errors: [expect.objectContaining({ code: "exact_file_duplicate" })],
    });

    const changedResult = await validateImportSource(
      sourceInput(`${lfCsv.replaceAll("\n", "\r\n")}\r\n`, {
        closingBalance: "917.55",
        sourceFilename: "regenerated.csv",
      }),
    );

    expect(changedResult.status).toBe("ready");

    if (changedResult.status === "ready") {
      expect(changedResult.preview.rows[0]?.warnings).toEqual([
        expect.objectContaining({ code: "prior_exact_row" }),
      ]);
    }

    const batchCount = context.raw
      .prepare("SELECT count(*) AS count FROM import_batches")
      .get() as { count: number };
    expect(batchCount.count).toBe(1);
  });

  it("converts liability statement balances and derives card effective dates", async () => {
    const cardId = await createFinancialAccount({
      name: "Visa",
      type: "credit_card",
      openingDate: "2026-07-31",
      openingBalanceMinor: 0,
      requiredForClose: true,
    });
    const csv = [
      "transaction_date,posted_date,description,amount,currency,type,category",
      "2026-08-04,2026-08-05,PURCHASE,-60.00,USD,expense,Groceries",
      "2026-08-10,2026-08-10,PAYMENT,200.00,USD,transfer,",
      "2026-08-12,2026-08-13,REFUND,20.00,USD,refund,Groceries",
    ].join("\n");
    const result = await validateImportSource(
      sourceInput(csv, {
        financialAccountId: cardId,
        openingBalance: "400.00",
        closingBalance: "240.00",
        sourceFilename: "august-card.csv",
      }),
    );

    expect(result.status).toBe("ready");

    if (result.status !== "ready") {
      return;
    }

    expect(result.preview.statement).toMatchObject({
      openingBalanceMinor: -40000,
      closingBalanceMinor: -24000,
      activityTotalMinor: 16000,
      expectedClosingBalanceMinor: -24000,
      differenceMinor: 0,
    });
    expect(result.preview.rows.map((row) => row.defaultEffectiveDate)).toEqual([
      "2026-08-04",
      "2026-08-10",
      "2026-08-12",
    ]);
  });

  it("prevents committed source rows and metadata from being edited or deleted", async () => {
    const csv = [
      "transaction_date,description,amount,currency",
      "2026-08-04,WHOLE FOODS,-82.45,USD",
    ].join("\n");
    await commitPreviewedImport(
      sourceInput(csv, {
        closingBalance: "917.55",
      }),
    );

    expect(() =>
      context.raw
        .prepare("UPDATE import_rows SET description = 'Changed' WHERE id = 1")
        .run(),
    ).toThrow("immutable");
    expect(() =>
      context.raw.prepare("DELETE FROM import_rows WHERE id = 1").run(),
    ).toThrow("cannot be deleted");
    expect(() =>
      context.raw
        .prepare(
          "UPDATE import_batches SET source_filename = 'changed.csv' WHERE id = 1",
        )
        .run(),
    ).toThrow("immutable");
    expect(() =>
      context.raw.prepare("DELETE FROM import_batches WHERE id = 1").run(),
    ).toThrow("cannot be deleted");

    expect(() =>
      context.raw
        .prepare("UPDATE import_batches SET review_status = 'in_review' WHERE id = 1")
        .run(),
    ).not.toThrow();
    expect(
      context.raw.prepare("SELECT is_sealed FROM import_batches WHERE id = 1").get(),
    ).toEqual({ is_sealed: 1 });
    expect(() =>
      context.raw.prepare("UPDATE import_batches SET is_sealed = 0 WHERE id = 1").run(),
    ).toThrow("cannot be unsealed");
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO import_rows (
             import_batch_id, original_row_number, transaction_date, posted_date,
             description, amount_minor, currency, external_id, merchant,
             suggested_type, suggested_category, suggested_category_id, notes,
             default_effective_date, normalized_fingerprint, validation_status,
             review_status, warnings_json
           )
           SELECT
             import_batch_id, 999, transaction_date, posted_date,
             description, amount_minor, currency, external_id, merchant,
             suggested_type, suggested_category, suggested_category_id, notes,
             default_effective_date, normalized_fingerprint, validation_status,
             review_status, warnings_json
           FROM import_rows
           WHERE id = 1`,
        )
        .run(),
    ).toThrow("membership is sealed");
  });
});
