import { eq, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import { financialAccounts, importBatches } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { refreshDuplicateCandidatesForBatch } from "@/features/reconciliation/duplicate-detection-service";
import { postAcceptedImportRowsInDatabase } from "@/features/reconciliation/import-posting-service";
import {
  getStatementReconciliationInDatabase,
  type StatementReconciliation,
} from "@/features/reconciliation/reconciliation-service";

export type FinalizeStatementResult = {
  batchId: number;
  finalizedAt: string;
  ledgerPostedAt: string;
  journalEntryCount: number;
  rowCount: number;
  acceptedCount: number;
  excludedCount: number;
  duplicateCount: number;
  sourceActivityTotalMinor: number;
  acceptedActivityTotalMinor: number;
  differenceMinor: 0;
};

function assertReadyToFinalize(statement: StatementReconciliation): void {
  if (statement.rows.length !== statement.batch.rowCount) {
    throw new Error(
      "The sealed statement row count no longer matches its source rows.",
    );
  }

  const blocker = statement.batchBlockers[0];
  if (!blocker) {
    return;
  }
  if (blocker.code === "rows_incomplete") {
    const blockedRow = statement.rows.find((row) => row.id === blocker.importRowIds[0]);
    throw new DomainError(
      blockedRow
        ? `Complete every row before finalizing. Row ${blockedRow.originalRowNumber}: ${blockedRow.blockers[0]!.message}`
        : blocker.message,
    );
  }
  if (blocker.code === "open_duplicate_candidates") {
    throw new DomainError(
      "Confirm or dismiss every open duplicate candidate before finalizing.",
    );
  }
  if (blocker.code === "inactive_categories") {
    throw new DomainError("Replace archived category allocations before finalizing.");
  }
  throw new DomainError(
    `The statement cannot be finalized with a reconciliation difference of ${blocker.differenceMinor} minor units.`,
  );
}

export async function finalizeImportBatch(
  importBatchId: number,
): Promise<FinalizeStatementResult> {
  if (!Number.isSafeInteger(importBatchId) || importBatchId <= 0) {
    throw new DomainError("The import statement identifier is invalid.");
  }

  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      const batch = transaction
        .select({
          id: importBatches.id,
          reviewStatus: importBatches.reviewStatus,
          accountName: financialAccounts.name,
          accountArchivedAt: financialAccounts.archivedAt,
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
      if (batch.reviewStatus === "finalized") {
        throw new DomainError("This statement is already finalized.");
      }
      if (batch.accountArchivedAt) {
        throw new DomainError(
          `Restore ${batch.accountName} before finalizing and posting this statement.`,
        );
      }

      const duplicateRefresh = refreshDuplicateCandidatesForBatch(
        transaction,
        importBatchId,
      );
      const statement = getStatementReconciliationInDatabase(
        transaction,
        importBatchId,
      );
      assertReadyToFinalize(statement);

      const counts = statement.rows.reduce(
        (result, row) => {
          if (row.decision.disposition === "accepted") {
            result.accepted += 1;
          } else if (row.decision.disposition === "excluded") {
            result.excluded += 1;
          } else if (row.decision.disposition === "duplicate") {
            result.duplicate += 1;
          }
          return result;
        },
        { accepted: 0, excluded: 0, duplicate: 0 },
      );
      const journalEntryCount = postAcceptedImportRowsInDatabase(
        transaction,
        importBatchId,
        statement.rows,
      );

      const updated = transaction
        .update(importBatches)
        .set({
          reviewStatus: "finalized",
          finalizedAt: sql`CURRENT_TIMESTAMP`,
          ledgerPostedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(importBatches.id, importBatchId))
        .run();
      if (updated.changes !== 1) {
        throw new Error("The statement finalization status could not be saved.");
      }

      const finalized = transaction
        .select({
          finalizedAt: importBatches.finalizedAt,
          ledgerPostedAt: importBatches.ledgerPostedAt,
        })
        .from(importBatches)
        .where(eq(importBatches.id, importBatchId))
        .get();
      if (!finalized?.finalizedAt || !finalized.ledgerPostedAt) {
        throw new Error("The finalized statement posting timestamps are missing.");
      }

      recordAuditEvent(transaction, {
        action: "import.batch_posted",
        entityType: "import_batch",
        entityId: importBatchId,
        details: {
          journalEntryCount,
          ledgerPostedAt: finalized.ledgerPostedAt,
          backfilled: false,
        },
      });

      recordAuditEvent(transaction, {
        action: "review.batch_finalized",
        entityType: "import_batch",
        entityId: importBatchId,
        details: {
          rowCount: statement.rows.length,
          acceptedCount: counts.accepted,
          excludedCount: counts.excluded,
          duplicateCount: counts.duplicate,
          sourceActivityTotalMinor: statement.reconciliation.sourceActivityTotalMinor,
          provisionalActivityTotalMinor:
            statement.reconciliation.provisionalActivityTotalMinor,
          acceptedActivityTotalMinor:
            statement.reconciliation.acceptedActivityTotalMinor,
          openingBalanceMinor: statement.reconciliation.openingBalanceMinor,
          closingBalanceMinor: statement.reconciliation.closingBalanceMinor,
          expectedClosingBalanceMinor:
            statement.reconciliation.expectedClosingBalanceMinor,
          differenceMinor: statement.reconciliation.differenceMinor,
          duplicateCandidateCount: duplicateRefresh.candidateCount,
          duplicateCandidateCreatedCount: duplicateRefresh.createdCount,
          finalizedAt: finalized.finalizedAt,
          ledgerPostedAt: finalized.ledgerPostedAt,
          journalEntryCount,
        },
      });

      return {
        batchId: importBatchId,
        finalizedAt: finalized.finalizedAt,
        ledgerPostedAt: finalized.ledgerPostedAt,
        journalEntryCount,
        rowCount: statement.rows.length,
        acceptedCount: counts.accepted,
        excludedCount: counts.excluded,
        duplicateCount: counts.duplicate,
        sourceActivityTotalMinor: statement.reconciliation.sourceActivityTotalMinor,
        acceptedActivityTotalMinor: statement.reconciliation.acceptedActivityTotalMinor,
        differenceMinor: 0,
      };
    },
    { behavior: "immediate" },
  );
}

export const finalizeStatement = finalizeImportBatch;
