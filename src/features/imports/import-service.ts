import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import { categories, financialAccounts, importBatches, importRows } from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import {
  financialAccountTypeSchema,
  toLedgerBalance,
  type FinancialAccountType,
} from "@/domain/accounts";
import { isCalendarDate } from "@/domain/calendar-date";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { parseMoneyToMinorUnits, sumMinorUnits } from "@/domain/money";
import { createSlug } from "@/domain/slug";
import { recordAuditEvent } from "@/features/audit/audit-service";
import {
  computeFileChecksum,
  computeRowFingerprint,
  csvSchemaVersion,
  maximumCsvFileBytes,
  parseCsvBytes,
  type ImportIssue,
  type NormalizedCsvRow,
} from "@/features/imports/csv-contract";
import { findBaseCurrency } from "@/features/settings/settings-repository";

export type ImportSourceInput = {
  financialAccountId: number;
  statementStartDate: string;
  statementEndDate: string;
  openingBalance: string;
  closingBalance: string;
  sourceFilename: string;
  bytes: Uint8Array;
};

export type PreviewImportRow = NormalizedCsvRow & {
  normalizedFingerprint: string;
  suggestedCategoryId: number | null;
  warnings: ImportIssue[];
};

export type ImportPreview = {
  approvalToken: string;
  checksum: string;
  csvSchemaVersion: typeof csvSchemaVersion;
  sourceFilename: string;
  account: {
    id: number;
    name: string;
    type: FinancialAccountType;
    currency: BaseCurrency;
    openingDate: string;
  };
  statement: {
    startDate: string;
    endDate: string;
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    activityTotalMinor: number;
    expectedClosingBalanceMinor: number;
    differenceMinor: number;
  };
  rows: PreviewImportRow[];
  warnings: ImportIssue[];
};

export type ImportValidationResult =
  | {
      status: "invalid";
      errors: ImportIssue[];
    }
  | {
      status: "ready";
      preview: ImportPreview;
    };

export type ImportHistoryItem = {
  id: number;
  sourceFilename: string;
  fileChecksum: string;
  csvSchemaVersion: string;
  statementStartDate: string;
  statementEndDate: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  rowCount: number;
  warningCount: number;
  reviewStatus: string;
  importedAt: string;
  accountName: string;
  accountType: FinancialAccountType;
  currency: BaseCurrency;
};

function metadataError(code: string, message: string, field?: string): ImportIssue {
  return {
    severity: "error",
    code,
    field,
    message,
  };
}

function sanitizeSourceFilename(value: string): string {
  return value.split(/[\\/]/).at(-1)?.trim().slice(0, 255) ?? "";
}

function addRowWarning(
  row: PreviewImportRow,
  code: string,
  message: string,
  field?: string,
): void {
  row.warnings.push({
    severity: "warning",
    code,
    field,
    message,
    rowNumber: row.originalRowNumber,
  });
}

function computeImportApprovalToken(
  preview: Omit<ImportPreview, "approvalToken">,
): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}

function expectedCategoryKind(
  suggestedType: PreviewImportRow["suggestedType"],
): "income" | "expense" | null {
  if (suggestedType === "income") {
    return "income";
  }

  if (suggestedType === "expense" || suggestedType === "refund") {
    return "expense";
  }

  return null;
}

function validateImportSourceWithDatabase(
  db: AppDatabase | AppTransaction,
  input: ImportSourceInput,
): ImportValidationResult {
  const errors: ImportIssue[] = [];
  const sourceFilename = sanitizeSourceFilename(input.sourceFilename);
  const accountIdIsValid =
    Number.isSafeInteger(input.financialAccountId) && input.financialAccountId > 0;

  if (!accountIdIsValid) {
    errors.push(
      metadataError(
        "invalid_account",
        "Choose an active account.",
        "financialAccountId",
      ),
    );
  }

  if (!isCalendarDate(input.statementStartDate)) {
    errors.push(
      metadataError(
        "invalid_statement_start",
        "Enter a valid statement start date.",
        "statementStartDate",
      ),
    );
  }

  if (!isCalendarDate(input.statementEndDate)) {
    errors.push(
      metadataError(
        "invalid_statement_end",
        "Enter a valid statement end date.",
        "statementEndDate",
      ),
    );
  }

  if (
    isCalendarDate(input.statementStartDate) &&
    isCalendarDate(input.statementEndDate) &&
    input.statementStartDate > input.statementEndDate
  ) {
    errors.push(
      metadataError(
        "statement_date_order",
        "The statement end date must be on or after its start date.",
      ),
    );
  }

  if (!sourceFilename) {
    errors.push(metadataError("missing_filename", "Choose a CSV file.", "file"));
  }

  if (input.bytes.byteLength === 0) {
    errors.push(metadataError("empty_file", "The selected CSV is empty.", "file"));
  } else if (input.bytes.byteLength > maximumCsvFileBytes) {
    errors.push(
      metadataError("file_too_large", "The CSV exceeds the 5 MB file limit.", "file"),
    );
  }

  const baseCurrency = findBaseCurrency(db);
  const account = accountIdIsValid
    ? db
        .select({
          id: financialAccounts.id,
          name: financialAccounts.name,
          type: financialAccounts.type,
          currency: financialAccounts.currency,
          openingDate: financialAccounts.openingDate,
        })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, input.financialAccountId),
            isNull(financialAccounts.archivedAt),
          ),
        )
        .get()
    : undefined;

  if (!baseCurrency) {
    errors.push(
      metadataError("missing_settings", "Complete currency setup before importing."),
    );
  }

  if (accountIdIsValid && !account) {
    errors.push(
      metadataError(
        "invalid_account",
        "Choose an active account.",
        "financialAccountId",
      ),
    );
  }

  if (
    account &&
    isCalendarDate(input.statementStartDate) &&
    input.statementStartDate < account.openingDate
  ) {
    errors.push(
      metadataError(
        "statement_before_account_opening",
        `The statement cannot start before the account opening date (${account.openingDate}).`,
        "statementStartDate",
      ),
    );
  }

  if (errors.length > 0 || !baseCurrency || !account) {
    return { status: "invalid", errors };
  }

  const accountCurrency = baseCurrencySchema.parse(account.currency);
  const accountType = financialAccountTypeSchema.parse(account.type);

  if (accountCurrency !== baseCurrency) {
    return {
      status: "invalid",
      errors: [
        metadataError(
          "account_currency_mismatch",
          `The account currency must match ${baseCurrency}.`,
          "financialAccountId",
        ),
      ],
    };
  }

  let openingBalanceMinor: number;
  let closingBalanceMinor: number;

  try {
    openingBalanceMinor = parseMoneyToMinorUnits(input.openingBalance, baseCurrency);
  } catch (error) {
    errors.push(
      metadataError(
        "invalid_opening_balance",
        error instanceof Error ? error.message : "Enter a valid opening balance.",
        "openingBalance",
      ),
    );
    openingBalanceMinor = 0;
  }

  try {
    closingBalanceMinor = parseMoneyToMinorUnits(input.closingBalance, baseCurrency);
  } catch (error) {
    errors.push(
      metadataError(
        "invalid_closing_balance",
        error instanceof Error ? error.message : "Enter a valid closing balance.",
        "closingBalance",
      ),
    );
    closingBalanceMinor = 0;
  }

  if (errors.length > 0) {
    return { status: "invalid", errors };
  }

  openingBalanceMinor = toLedgerBalance(accountType, openingBalanceMinor);
  closingBalanceMinor = toLedgerBalance(accountType, closingBalanceMinor);

  const checksum = computeFileChecksum(input.bytes);
  const priorBatch = db
    .select({
      id: importBatches.id,
      sourceFilename: importBatches.sourceFilename,
    })
    .from(importBatches)
    .where(eq(importBatches.fileChecksum, checksum))
    .get();

  if (priorBatch) {
    return {
      status: "invalid",
      errors: [
        metadataError(
          "exact_file_duplicate",
          `This exact file was already committed as import #${priorBatch.id} (${priorBatch.sourceFilename}).`,
          "file",
        ),
      ],
    };
  }

  const parsed = parseCsvBytes(input.bytes, {
    accountType,
    baseCurrency,
  });

  if (parsed.errors.length > 0) {
    return {
      status: "invalid",
      errors: parsed.errors,
    };
  }

  const activeCategories = db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
    })
    .from(categories)
    .where(isNull(categories.archivedAt))
    .all();
  const categoriesByName = new Map(
    activeCategories.map((category) => [createSlug(category.name), category]),
  );
  const externalIdCounts = new Map<string, number>();

  for (const row of parsed.rows) {
    if (row.externalId) {
      externalIdCounts.set(
        row.externalId,
        (externalIdCounts.get(row.externalId) ?? 0) + 1,
      );
    }
  }

  const fingerprints = parsed.rows.map((row) => computeRowFingerprint(account.id, row));
  const priorFingerprints =
    fingerprints.length === 0
      ? []
      : db
          .select({ fingerprint: importRows.normalizedFingerprint })
          .from(importRows)
          .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
          .where(
            and(
              eq(importBatches.financialAccountId, account.id),
              inArray(importRows.normalizedFingerprint, fingerprints),
            ),
          )
          .all();
  const priorFingerprintSet = new Set(priorFingerprints.map((row) => row.fingerprint));
  const rows: PreviewImportRow[] = parsed.rows.map((row, index) => ({
    ...row,
    normalizedFingerprint: fingerprints[index]!,
    suggestedCategoryId: null,
    warnings: [],
  }));

  for (const row of rows) {
    if (
      row.transactionDate < account.openingDate ||
      (row.postedDate !== null && row.postedDate < account.openingDate) ||
      row.defaultEffectiveDate < account.openingDate
    ) {
      errors.push({
        severity: "error",
        code: "row_before_account_opening",
        field: "transaction_date",
        message: `Transaction and posted dates cannot be before the account opening date (${account.openingDate}).`,
        rowNumber: row.originalRowNumber,
      });
    }

    if (
      row.transactionDate < input.statementStartDate ||
      row.transactionDate > input.statementEndDate
    ) {
      addRowWarning(
        row,
        "transaction_date_outside_statement",
        "Transaction date falls outside the entered statement period.",
        "transaction_date",
      );
    }

    if (
      row.postedDate &&
      (row.postedDate < input.statementStartDate ||
        row.postedDate > input.statementEndDate)
    ) {
      addRowWarning(
        row,
        "posted_date_outside_statement",
        "Posted date falls outside the entered statement period.",
        "posted_date",
      );
    }

    if (row.postedDate && row.postedDate < row.transactionDate) {
      addRowWarning(
        row,
        "posted_before_transaction",
        "Posted date is earlier than transaction date.",
        "posted_date",
      );
    }

    if (row.externalId && (externalIdCounts.get(row.externalId) ?? 0) > 1) {
      addRowWarning(
        row,
        "repeated_external_id",
        `External ID ${row.externalId} appears more than once in this file.`,
        "external_id",
      );
    }

    if (priorFingerprintSet.has(row.normalizedFingerprint)) {
      addRowWarning(
        row,
        "prior_exact_row",
        "An exact normalized row already exists for this account.",
      );
    }

    if (row.suggestedCategory) {
      const category = categoriesByName.get(createSlug(row.suggestedCategory));
      const requiredKind = expectedCategoryKind(row.suggestedType);

      if (!category) {
        addRowWarning(
          row,
          "unknown_category",
          `Category suggestion “${row.suggestedCategory}” was not found and remains unresolved.`,
          "category",
        );
      } else if (requiredKind && category.kind !== requiredKind) {
        addRowWarning(
          row,
          "category_kind_mismatch",
          `${category.name} is not an ${requiredKind} category.`,
          "category",
        );
      } else if (
        row.suggestedType === "transfer" ||
        row.suggestedType === "adjustment"
      ) {
        addRowWarning(
          row,
          "category_not_applicable",
          `${row.suggestedType} suggestions should not use an income or expense category.`,
          "category",
        );
      } else {
        row.suggestedCategoryId = category.id;
      }
    }

    if (
      /\b(unknown|unclear|unreadable|illegible|uncertain)\b/i.test(row.description) ||
      /^(n\/?a|missing|not provided|\?+)$/i.test(row.description.trim())
    ) {
      addRowWarning(
        row,
        "description_uncertainty",
        "The source description appears uncertain or incomplete and requires review.",
        "description",
      );
    }

    if (
      row.notes &&
      /\b(uncertain|unclear|possible|unknown|unreadable)\b/i.test(row.notes)
    ) {
      addRowWarning(
        row,
        "source_uncertainty",
        "The source notes indicate uncertainty that requires review.",
        "notes",
      );
    }
  }

  if (errors.length > 0) {
    return { status: "invalid", errors };
  }

  const activityTotalMinor = sumMinorUnits(
    rows.map((row) => row.amountMinor),
    "The combined CSV activity is too large.",
  );
  const expectedClosingBalanceMinor = sumMinorUnits(
    [openingBalanceMinor, activityTotalMinor],
    "The expected closing balance is too large.",
  );
  const differenceMinor = sumMinorUnits(
    [closingBalanceMinor, -expectedClosingBalanceMinor],
    "The statement balance difference is too large.",
  );
  const warnings: ImportIssue[] = [];

  if (differenceMinor !== 0) {
    warnings.unshift({
      severity: "warning",
      code: "statement_balance_mismatch",
      message:
        "Opening balance plus CSV activity does not equal the entered closing balance.",
    });
  }

  const preview: Omit<ImportPreview, "approvalToken"> = {
    checksum,
    csvSchemaVersion,
    sourceFilename,
    account: {
      id: account.id,
      name: account.name,
      type: accountType,
      currency: accountCurrency,
      openingDate: account.openingDate,
    },
    statement: {
      startDate: input.statementStartDate,
      endDate: input.statementEndDate,
      openingBalanceMinor,
      closingBalanceMinor,
      activityTotalMinor,
      expectedClosingBalanceMinor,
      differenceMinor,
    },
    rows,
    warnings,
  };

  return {
    status: "ready",
    preview: {
      ...preview,
      approvalToken: computeImportApprovalToken(preview),
    },
  };
}

export async function validateImportSource(
  input: ImportSourceInput,
): Promise<ImportValidationResult> {
  const { db } = await getDatabaseContext();

  return validateImportSourceWithDatabase(db, input);
}

export async function commitValidatedImport(
  input: ImportSourceInput,
  expectedApprovalToken: string,
): Promise<
  | {
      status: "invalid";
      errors: ImportIssue[];
    }
  | {
      status: "committed";
      batchId: number;
      rowCount: number;
    }
> {
  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      const validation = validateImportSourceWithDatabase(transaction, input);

      if (validation.status === "invalid") {
        return validation;
      }

      const { preview } = validation;

      if (!expectedApprovalToken || expectedApprovalToken !== preview.approvalToken) {
        return {
          status: "invalid" as const,
          errors: [
            metadataError(
              "stale_preview",
              "The source or related data changed after preview. Validate it again before committing.",
            ),
          ],
        };
      }

      const warningCount =
        preview.warnings.length +
        preview.rows.reduce((count, row) => count + row.warnings.length, 0);
      const result = transaction
        .insert(importBatches)
        .values({
          financialAccountId: preview.account.id,
          sourceFilename: preview.sourceFilename,
          fileChecksum: preview.checksum,
          csvSchemaVersion: preview.csvSchemaVersion,
          currency: preview.account.currency,
          statementStartDate: preview.statement.startDate,
          statementEndDate: preview.statement.endDate,
          openingBalanceMinor: preview.statement.openingBalanceMinor,
          closingBalanceMinor: preview.statement.closingBalanceMinor,
          rowCount: preview.rows.length,
          warningCount,
          validationStatus: "validated",
          reviewStatus: "pending",
          isSealed: false,
        })
        .run();
      const importBatchId = Number(result.lastInsertRowid);
      const rowValues = preview.rows.map((row) => ({
        importBatchId,
        originalRowNumber: row.originalRowNumber,
        transactionDate: row.transactionDate,
        postedDate: row.postedDate,
        description: row.description,
        amountMinor: row.amountMinor,
        currency: row.currency,
        externalId: row.externalId,
        merchant: row.merchant,
        suggestedType: row.suggestedType,
        suggestedCategory: row.suggestedCategory,
        suggestedCategoryId: row.suggestedCategoryId,
        notes: row.notes,
        defaultEffectiveDate: row.defaultEffectiveDate,
        normalizedFingerprint: row.normalizedFingerprint,
        validationStatus: row.warnings.length > 0 ? "valid_with_warnings" : "valid",
        reviewStatus: "unresolved",
        warningsJson: JSON.stringify(row.warnings),
      }));

      for (let offset = 0; offset < rowValues.length; offset += 250) {
        transaction
          .insert(importRows)
          .values(rowValues.slice(offset, offset + 250))
          .run();
      }

      const sealed = transaction
        .update(importBatches)
        .set({ isSealed: true })
        .where(
          and(eq(importBatches.id, importBatchId), eq(importBatches.isSealed, false)),
        )
        .run();

      if (sealed.changes !== 1) {
        throw new Error("The validated import batch could not be sealed.");
      }

      recordAuditEvent(transaction, {
        action: "import.committed",
        entityType: "import_batch",
        entityId: importBatchId,
        details: {
          checksum: preview.checksum,
          csvSchemaVersion: preview.csvSchemaVersion,
          financialAccountId: preview.account.id,
          rowCount: preview.rows.length,
          sourceFilename: preview.sourceFilename,
          warningCount,
        },
      });

      return {
        status: "committed" as const,
        batchId: importBatchId,
        rowCount: preview.rows.length,
      };
    },
    { behavior: "immediate" },
  );
}

export async function listImportHistory(
  limit = 50,
  offset = 0,
): Promise<ImportHistoryItem[]> {
  const { db } = await getDatabaseContext();
  const rows = db
    .select({
      id: importBatches.id,
      sourceFilename: importBatches.sourceFilename,
      fileChecksum: importBatches.fileChecksum,
      csvSchemaVersion: importBatches.csvSchemaVersion,
      statementStartDate: importBatches.statementStartDate,
      statementEndDate: importBatches.statementEndDate,
      openingBalanceMinor: importBatches.openingBalanceMinor,
      closingBalanceMinor: importBatches.closingBalanceMinor,
      rowCount: importBatches.rowCount,
      warningCount: importBatches.warningCount,
      reviewStatus: importBatches.reviewStatus,
      importedAt: importBatches.importedAt,
      accountName: financialAccounts.name,
      accountType: financialAccounts.type,
      currency: importBatches.currency,
    })
    .from(importBatches)
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .orderBy(desc(importBatches.importedAt), desc(importBatches.id))
    .limit(limit)
    .offset(offset)
    .all();

  return rows.map((row) => ({
    ...row,
    accountType: financialAccountTypeSchema.parse(row.accountType),
    currency: baseCurrencySchema.parse(row.currency),
  }));
}

export async function countImportBatches(): Promise<number> {
  const { db } = await getDatabaseContext();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(importBatches)
    .get();

  return Number(result?.count ?? 0);
}
