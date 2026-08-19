import { eq } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import { financialAccounts, importBatches } from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import {
  calculateReconciliation,
  getStatementBatchBlockers,
  type ReconciliationResult,
  type ReviewBlocker,
  type StatementBatchBlocker,
} from "@/domain/review";
import {
  loadReviewRowsInDatabase,
  type ReviewRowView,
} from "@/features/reconciliation/review-row-loader";

export {
  deriveTransferCandidates,
  type TransferCandidateHint,
  type TransferCandidateSource,
} from "@/features/reconciliation/transfer-candidates";

type ReconciliationDatabase = AppDatabase | AppTransaction;

export type ReconciliationServiceRowBlocker = ReviewBlocker;
export type StatementReconciliationRow = ReviewRowView;
export type { StatementBatchBlocker };

export type StatementReconciliation = {
  batch: {
    id: number;
    sourceFilename: string;
    currency: BaseCurrency;
    statementStartDate: string;
    statementEndDate: string;
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    reviewStatus: "pending" | "in_review" | "finalized";
    finalizedAt: string | null;
    ledgerPostedAt: string | null;
    rowCount: number;
    warningCount: number;
    importedAt: string;
  };
  account: ReviewRowView["account"];
  rows: StatementReconciliationRow[];
  reconciliation: ReconciliationResult;
  totals: ReconciliationResult;
  rowBlockers: Array<{
    importRowId: number;
    blockers: ReconciliationServiceRowBlocker[];
  }>;
  batchBlockers: StatementBatchBlocker[];
};

function parseReviewStatus(value: string): "pending" | "in_review" | "finalized" {
  if (value === "pending" || value === "in_review" || value === "finalized") {
    return value;
  }
  throw new Error(`Unknown import review status: ${value}`);
}

export function getStatementReconciliationInDatabase(
  database: ReconciliationDatabase,
  importBatchId: number,
): StatementReconciliation {
  const batch = database
    .select({
      id: importBatches.id,
      sourceFilename: importBatches.sourceFilename,
      currency: importBatches.currency,
      statementStartDate: importBatches.statementStartDate,
      statementEndDate: importBatches.statementEndDate,
      openingBalanceMinor: importBatches.openingBalanceMinor,
      closingBalanceMinor: importBatches.closingBalanceMinor,
      reviewStatus: importBatches.reviewStatus,
      finalizedAt: importBatches.finalizedAt,
      ledgerPostedAt: importBatches.ledgerPostedAt,
      rowCount: importBatches.rowCount,
      warningCount: importBatches.warningCount,
      importedAt: importBatches.importedAt,
      accountId: financialAccounts.id,
    })
    .from(importBatches)
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .where(eq(importBatches.id, importBatchId))
    .get();
  if (!batch) {
    throw new DomainError("The import statement does not exist.");
  }

  const rows = loadReviewRowsInDatabase(database, { batchId: importBatchId });
  const account = rows[0]?.account;
  if (!account) {
    throw new Error("The imported statement does not contain its sealed source rows.");
  }
  const reconciliation = calculateReconciliation({
    openingBalanceMinor: batch.openingBalanceMinor,
    closingBalanceMinor: batch.closingBalanceMinor,
    activity: rows.map((row) => ({
      amountMinor: row.amountMinor,
      disposition: row.decision.disposition,
    })),
  });
  const rowBlockers = rows
    .filter((row) => row.blockers.length > 0)
    .map((row) => ({ importRowId: row.id, blockers: row.blockers }));
  const batchBlockers = getStatementBatchBlockers(rows, reconciliation);

  return {
    batch: {
      id: batch.id,
      sourceFilename: batch.sourceFilename,
      currency: baseCurrencySchema.parse(batch.currency),
      statementStartDate: batch.statementStartDate,
      statementEndDate: batch.statementEndDate,
      openingBalanceMinor: batch.openingBalanceMinor,
      closingBalanceMinor: batch.closingBalanceMinor,
      reviewStatus: parseReviewStatus(batch.reviewStatus),
      finalizedAt: batch.finalizedAt,
      ledgerPostedAt: batch.ledgerPostedAt,
      rowCount: batch.rowCount,
      warningCount: batch.warningCount,
      importedAt: batch.importedAt,
    },
    account,
    rows,
    reconciliation,
    totals: reconciliation,
    rowBlockers,
    batchBlockers,
  };
}

export async function getStatementReconciliation(
  importBatchId: number,
): Promise<StatementReconciliation> {
  if (!Number.isSafeInteger(importBatchId) || importBatchId <= 0) {
    throw new DomainError("The import statement identifier is invalid.");
  }
  const { db } = await getDatabaseContext();
  return getStatementReconciliationInDatabase(db, importBatchId);
}

export const getStatementDetails = getStatementReconciliation;
export const getStatementReconciliationDetails = getStatementReconciliation;
