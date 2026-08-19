import { and, eq, inArray, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  importBatches,
  financialAccounts,
  importRowJournalEntries,
  importRows,
  ledgerAccounts,
} from "@/db/schema";
import type { AppTransaction } from "@/db/types";
import { DomainError } from "@/domain/errors";
import { buildImportRowPostings } from "@/domain/import-posting";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { postJournalEntryWithinTransaction } from "@/features/ledger/ledger-service";
import {
  loadReviewRowsInDatabase,
  type ReviewRowView,
} from "@/features/reconciliation/review-row-loader";
import { ensureExternalTransferReclassificationInDatabase } from "@/features/transfers/transfer-service";

export type ImportPostingResult = {
  batchId: number;
  journalEntryCount: number;
  ledgerPostedAt: string;
};

export function postAcceptedImportRowsInDatabase(
  transaction: AppTransaction,
  importBatchId: number,
  suppliedRows?: readonly ReviewRowView[],
): number {
  const rows =
    suppliedRows ?? loadReviewRowsInDatabase(transaction, { batchId: importBatchId });
  const acceptedRows = rows.filter((row) => row.decision.disposition === "accepted");
  const rowIds = rows.map((row) => row.id);
  const existingLinks =
    rowIds.length === 0
      ? []
      : transaction
          .select({ importRowId: importRowJournalEntries.importRowId })
          .from(importRowJournalEntries)
          .where(inArray(importRowJournalEntries.importRowId, rowIds))
          .all();
  if (existingLinks.length > 0) {
    throw new Error("This statement has already created import journal links.");
  }
  if (acceptedRows.length === 0) {
    return 0;
  }

  const identities = transaction
    .select({
      id: ledgerAccounts.id,
      systemKey: ledgerAccounts.systemKey,
      financialAccountId: ledgerAccounts.financialAccountId,
      categoryId: ledgerAccounts.categoryId,
    })
    .from(ledgerAccounts)
    .all();
  const transferClearingLedgerAccountId = identities.find(
    (identity) => identity.systemKey === "transfer_clearing",
  )?.id;
  const manualAdjustmentsLedgerAccountId = identities.find(
    (identity) => identity.systemKey === "manual_adjustments",
  )?.id;
  if (!transferClearingLedgerAccountId || !manualAdjustmentsLedgerAccountId) {
    throw new Error("The required system ledger accounts are missing.");
  }
  const accountLedgerIds = new Map(
    identities
      .filter((identity) => identity.financialAccountId !== null)
      .map((identity) => [identity.financialAccountId!, identity.id]),
  );
  const categoryLedgerIds = new Map(
    identities
      .filter((identity) => identity.categoryId !== null)
      .map((identity) => [identity.categoryId!, identity.id]),
  );

  for (const row of acceptedRows) {
    const confirmedType = row.decision.confirmedType;
    const effectiveDate = row.decision.effectiveDate;
    const financialLedgerAccountId = accountLedgerIds.get(row.account.id);
    if (!confirmedType || !effectiveDate || !financialLedgerAccountId) {
      throw new Error("An accepted import row is incomplete for ledger posting.");
    }
    const allocations = row.decision.allocations.map((allocation) => {
      const ledgerAccountId = categoryLedgerIds.get(allocation.categoryId);
      if (!ledgerAccountId) {
        throw new Error("A reviewed category ledger account is missing.");
      }
      return {
        ledgerAccountId,
        amountMinor: allocation.amountMinor,
        categoryName: allocation.category.name,
      };
    });
    const postings = buildImportRowPostings({
      amountMinor: row.amountMinor,
      confirmedType,
      financialLedgerAccountId,
      transferClearingLedgerAccountId,
      manualAdjustmentsLedgerAccountId,
      allocations,
    });

    postJournalEntryWithinTransaction(transaction, {
      effectiveDate,
      description: row.description,
      sourceType: "import",
      importSourceRowId: row.id,
      notes: row.decision.reviewNote ?? row.notes ?? undefined,
      postings,
    });
    if (confirmedType === "transfer") {
      ensureExternalTransferReclassificationInDatabase(transaction, row.id);
    }
  }

  return acceptedRows.length;
}

export async function postFinalizedImportBatch(
  importBatchId: number,
): Promise<ImportPostingResult> {
  if (!Number.isSafeInteger(importBatchId) || importBatchId <= 0) {
    throw new DomainError("The import statement identifier is invalid.");
  }
  const { db } = await getDatabaseContext();
  return db.transaction(
    (transaction) => {
      const batch = transaction
        .select({
          reviewStatus: importBatches.reviewStatus,
          ledgerPostedAt: importBatches.ledgerPostedAt,
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
      if (batch.reviewStatus !== "finalized") {
        throw new DomainError("Review and finalize this statement before posting it.");
      }
      if (batch.ledgerPostedAt) {
        const existing = transaction
          .select({ importRowId: importRowJournalEntries.importRowId })
          .from(importRowJournalEntries)
          .innerJoin(importRows, eq(importRows.id, importRowJournalEntries.importRowId))
          .where(eq(importRows.importBatchId, importBatchId))
          .all();
        return {
          batchId: importBatchId,
          journalEntryCount: existing.length,
          ledgerPostedAt: batch.ledgerPostedAt,
        };
      }
      if (batch.accountArchivedAt) {
        throw new DomainError(
          `Restore ${batch.accountName} before posting this statement.`,
        );
      }

      const journalEntryCount = postAcceptedImportRowsInDatabase(
        transaction,
        importBatchId,
      );
      transaction
        .update(importBatches)
        .set({ ledgerPostedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(importBatches.id, importBatchId),
            sql`${importBatches.ledgerPostedAt} IS NULL`,
          ),
        )
        .run();
      const posted = transaction
        .select({ ledgerPostedAt: importBatches.ledgerPostedAt })
        .from(importBatches)
        .where(eq(importBatches.id, importBatchId))
        .get();
      if (!posted?.ledgerPostedAt) {
        throw new Error("The import ledger posting timestamp is missing.");
      }
      recordAuditEvent(transaction, {
        action: "import.batch_posted",
        entityType: "import_batch",
        entityId: importBatchId,
        details: {
          journalEntryCount,
          ledgerPostedAt: posted.ledgerPostedAt,
          backfilled: true,
        },
      });
      return {
        batchId: importBatchId,
        journalEntryCount,
        ledgerPostedAt: posted.ledgerPostedAt,
      };
    },
    { behavior: "immediate" },
  );
}
