import { and, eq, inArray, or, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  appSettings,
  financialAccounts,
  importBatches,
  importRowDecisions,
  importRowJournalEntries,
  importRows,
  importTransferResolutions,
  journalEntries,
  ledgerAccounts,
  manualItems,
  postings,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { financialAccountTypeSchema } from "@/domain/accounts";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import {
  assertExternalTransferDirection,
  assertTransferMatchWindow,
  inferMatchedTransferClassification,
  type TransferClassification,
} from "@/domain/transfers";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { postJournalEntryWithinTransaction } from "@/features/ledger/ledger-service";
import {
  deriveTransferCandidates,
  type TransferCandidateHint,
  type TransferCandidateSource,
} from "@/features/reconciliation/transfer-candidates";

export type TransferWorkspaceRow = TransferCandidateSource & {
  importBatchId: number;
  originalRowNumber: number;
  postedDate: string | null;
  effectiveDate: string;
  reviewStatus: "pending" | "in_review" | "finalized";
  accountType: ReturnType<typeof financialAccountTypeSchema.parse>;
  resolution: {
    classification: TransferClassification;
    counterpartImportRowId: number | null;
    counterpartAccountName: string | null;
    counterpartDescription: string | null;
    manualItemName: string | null;
    updatedAt: string;
  } | null;
  candidates: TransferCandidateHint[];
};

function parseReviewStatus(value: string): "pending" | "in_review" | "finalized" {
  if (value === "pending" || value === "in_review" || value === "finalized") {
    return value;
  }
  throw new Error(`Unknown import review status: ${value}`);
}

export async function listTransferWorkspaceRows(): Promise<TransferWorkspaceRow[]> {
  const { db } = await getDatabaseContext();
  const rows = db
    .select({
      id: importRows.id,
      importBatchId: importRows.importBatchId,
      originalRowNumber: importRows.originalRowNumber,
      transactionDate: importRows.transactionDate,
      postedDate: importRows.postedDate,
      description: importRows.description,
      amountMinor: importRows.amountMinor,
      currency: importRows.currency,
      suggestedType: importRows.suggestedType,
      confirmedType: importRowDecisions.confirmedType,
      effectiveDate: importRowDecisions.effectiveDate,
      accountId: financialAccounts.id,
      accountName: financialAccounts.name,
      accountType: financialAccounts.type,
      reviewStatus: importBatches.reviewStatus,
    })
    .from(importRows)
    .innerJoin(
      importRowDecisions,
      and(
        eq(importRowDecisions.importRowId, importRows.id),
        eq(importRowDecisions.disposition, "accepted"),
        eq(importRowDecisions.confirmedType, "transfer"),
      ),
    )
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .orderBy(importRows.transactionDate, importRows.id)
    .all();
  const sources: TransferCandidateSource[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    accountName: row.accountName,
    currency: baseCurrencySchema.parse(row.currency),
    amountMinor: row.amountMinor,
    transactionDate: row.transactionDate,
    description: row.description,
    suggestedType: row.suggestedType === "transfer" ? "transfer" : null,
    confirmedType: "transfer",
  }));
  const candidatesByRow = deriveTransferCandidates(sources);
  const resolutions = db
    .select({
      id: importTransferResolutions.id,
      importRowId: importTransferResolutions.importRowId,
      classification: importTransferResolutions.classification,
      counterpartImportRowId: importTransferResolutions.counterpartImportRowId,
      reclassificationJournalEntryId:
        importTransferResolutions.reclassificationJournalEntryId,
      manualItemId: importTransferResolutions.manualItemId,
      manualItemName: manualItems.name,
      createdAt: importTransferResolutions.createdAt,
      updatedAt: importTransferResolutions.updatedAt,
    })
    .from(importTransferResolutions)
    .leftJoin(manualItems, eq(manualItems.id, importTransferResolutions.manualItemId))
    .all();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const resolutionByRow = new Map(
    resolutions.map((resolution) => [resolution.importRowId, resolution]),
  );

  return rows.map((row) => {
    if (!row.effectiveDate) {
      throw new Error("An accepted transfer is missing its effective date.");
    }
    const resolution = resolutionByRow.get(row.id);
    const counterpart = resolution?.counterpartImportRowId
      ? sourceById.get(resolution.counterpartImportRowId)
      : undefined;
    return {
      ...sources.find((source) => source.id === row.id)!,
      importBatchId: row.importBatchId,
      originalRowNumber: row.originalRowNumber,
      postedDate: row.postedDate,
      effectiveDate: row.effectiveDate,
      reviewStatus: parseReviewStatus(row.reviewStatus),
      accountType: financialAccountTypeSchema.parse(row.accountType),
      resolution: resolution
        ? {
            classification: resolution.classification as TransferClassification,
            counterpartImportRowId: resolution.counterpartImportRowId,
            counterpartAccountName: counterpart?.accountName ?? null,
            counterpartDescription: counterpart?.description ?? null,
            manualItemName: resolution.manualItemName,
            updatedAt: resolution.updatedAt,
          }
        : null,
      candidates: (candidatesByRow.get(row.id) ?? []).filter((candidate) => {
        const candidateResolution = resolutionByRow.get(candidate.candidateImportRowId);
        return (
          !candidateResolution ||
          resolution?.counterpartImportRowId === candidate.candidateImportRowId
        );
      }),
    };
  });
}

function loadTransferRow(database: AppDatabase | AppTransaction, importRowId: number) {
  return database
    .select({
      id: importRows.id,
      amountMinor: importRows.amountMinor,
      description: importRows.description,
      currency: importRows.currency,
      transactionDate: importRows.transactionDate,
      effectiveDate: importRowDecisions.effectiveDate,
      sourceJournalEntryId: importRowJournalEntries.journalEntryId,
      accountId: financialAccounts.id,
      accountType: financialAccounts.type,
    })
    .from(importRows)
    .innerJoin(
      importRowDecisions,
      and(
        eq(importRowDecisions.importRowId, importRows.id),
        eq(importRowDecisions.disposition, "accepted"),
        eq(importRowDecisions.confirmedType, "transfer"),
      ),
    )
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .leftJoin(
      importRowJournalEntries,
      eq(importRowJournalEntries.importRowId, importRows.id),
    )
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .where(eq(importRows.id, importRowId))
    .get();
}

export type ClearedTransferResolution = {
  importRowId: number;
  classification: string;
  counterpartImportRowId: number | null;
};

function createExternalTransferReclassificationInDatabase(
  transaction: AppTransaction,
  input: {
    amountMinor: number;
    description: string;
    effectiveDate: string;
  },
): number {
  const systemLedgers = transaction
    .select({ id: ledgerAccounts.id, systemKey: ledgerAccounts.systemKey })
    .from(ledgerAccounts)
    .where(
      inArray(ledgerAccounts.systemKey, [
        "transfer_clearing",
        "outside_scope_transfers",
      ]),
    )
    .all();
  const transferClearingLedgerAccountId = systemLedgers.find(
    (ledger) => ledger.systemKey === "transfer_clearing",
  )?.id;
  const outsideScopeLedgerAccountId = systemLedgers.find(
    (ledger) => ledger.systemKey === "outside_scope_transfers",
  )?.id;
  if (!transferClearingLedgerAccountId || !outsideScopeLedgerAccountId) {
    throw new Error("The transfer explanation ledger accounts are missing.");
  }

  return postJournalEntryWithinTransaction(transaction, {
    effectiveDate: input.effectiveDate,
    description: `Outside-scope transfer — ${input.description}`,
    sourceType: "system",
    notes:
      "Reclassified from transfer clearing after confirming an owned account outside this workspace.",
    postings: [
      {
        ledgerAccountId: transferClearingLedgerAccountId,
        amountMinor: input.amountMinor,
        memo: "Resolved outside the tracked account set",
      },
      {
        ledgerAccountId: outsideScopeLedgerAccountId,
        amountMinor: -input.amountMinor,
        memo: "Owned account outside this workspace",
      },
    ],
  });
}

function reverseExternalTransferReclassificationInDatabase(
  transaction: AppTransaction,
  journalEntryId: number,
): void {
  const entry = transaction
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, journalEntryId))
    .get();
  if (!entry?.isPosted || entry.sourceType !== "system") {
    throw new Error("The outside-scope transfer reclassification is invalid.");
  }
  const existingReversal = transaction
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, journalEntryId))
    .get();
  if (existingReversal) {
    return;
  }
  const originalPostings = transaction
    .select({
      ledgerAccountId: postings.ledgerAccountId,
      amountMinor: postings.amountMinor,
      memo: postings.memo,
    })
    .from(postings)
    .where(eq(postings.journalEntryId, journalEntryId))
    .all();

  postJournalEntryWithinTransaction(transaction, {
    effectiveDate: entry.effectiveDate,
    description: `Reversal: ${entry.description}`,
    sourceType: "system",
    notes: "The outside-scope transfer explanation was changed.",
    reversesEntryId: entry.id,
    postings: originalPostings.map((posting) => ({
      ledgerAccountId: posting.ledgerAccountId,
      amountMinor: -posting.amountMinor,
      memo: posting.memo ?? undefined,
    })),
  });
}

export function ensureExternalTransferReclassificationInDatabase(
  transaction: AppTransaction,
  importRowId: number,
): number | null {
  const resolution = transaction
    .select({
      id: importTransferResolutions.id,
      classification: importTransferResolutions.classification,
      reclassificationJournalEntryId:
        importTransferResolutions.reclassificationJournalEntryId,
      amountMinor: importRows.amountMinor,
      description: importRows.description,
      effectiveDate: importRowDecisions.effectiveDate,
      sourceJournalEntryId: importRowJournalEntries.journalEntryId,
    })
    .from(importTransferResolutions)
    .innerJoin(importRows, eq(importRows.id, importTransferResolutions.importRowId))
    .innerJoin(
      importRowDecisions,
      eq(importRowDecisions.importRowId, importTransferResolutions.importRowId),
    )
    .leftJoin(
      importRowJournalEntries,
      eq(importRowJournalEntries.importRowId, importTransferResolutions.importRowId),
    )
    .where(eq(importTransferResolutions.importRowId, importRowId))
    .get();

  if (
    !resolution ||
    (resolution.classification !== "external_out" &&
      resolution.classification !== "external_in")
  ) {
    return null;
  }
  if (resolution.reclassificationJournalEntryId) {
    return resolution.reclassificationJournalEntryId;
  }
  if (!resolution.sourceJournalEntryId) {
    return null;
  }
  if (!resolution.effectiveDate) {
    throw new Error("The accepted transfer is missing its effective date.");
  }

  const reclassificationJournalEntryId =
    createExternalTransferReclassificationInDatabase(transaction, {
      amountMinor: resolution.amountMinor,
      description: resolution.description,
      effectiveDate: resolution.effectiveDate,
    });
  const updated = transaction
    .update(importTransferResolutions)
    .set({
      reclassificationJournalEntryId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(importTransferResolutions.id, resolution.id))
    .run();
  if (updated.changes !== 1) {
    throw new Error("The outside-scope transfer explanation could not be linked.");
  }
  return reclassificationJournalEntryId;
}

export function clearTransferResolutionsInDatabase(
  transaction: AppTransaction,
  importRowIds: readonly number[],
): ClearedTransferResolution[] {
  const conditions = importRowIds.flatMap((importRowId) => [
    eq(importTransferResolutions.importRowId, importRowId),
    eq(importTransferResolutions.counterpartImportRowId, importRowId),
  ]);
  if (conditions.length === 0) {
    return [];
  }
  const resolutions = transaction
    .select({
      id: importTransferResolutions.id,
      importRowId: importTransferResolutions.importRowId,
      classification: importTransferResolutions.classification,
      counterpartImportRowId: importTransferResolutions.counterpartImportRowId,
      reclassificationJournalEntryId:
        importTransferResolutions.reclassificationJournalEntryId,
    })
    .from(importTransferResolutions)
    .where(or(...conditions))
    .all();
  if (resolutions.length === 0) {
    return [];
  }
  for (const resolution of resolutions) {
    if (resolution.reclassificationJournalEntryId) {
      reverseExternalTransferReclassificationInDatabase(
        transaction,
        resolution.reclassificationJournalEntryId,
      );
    }
  }
  transaction
    .delete(importTransferResolutions)
    .where(
      inArray(
        importTransferResolutions.id,
        resolutions.map((resolution) => resolution.id),
      ),
    )
    .run();
  return resolutions.map((resolution) => ({
    importRowId: resolution.importRowId,
    classification: resolution.classification,
    counterpartImportRowId: resolution.counterpartImportRowId,
  }));
}

export async function classifyTransfer(input: {
  importRowId: number;
  classification: "external_out" | "external_in" | "in_transit";
}): Promise<void> {
  const { db } = await getDatabaseContext();
  db.transaction(
    (transaction) => {
      const row = loadTransferRow(transaction, input.importRowId);
      if (!row) {
        throw new DomainError("The accepted transfer row does not exist.");
      }
      if (input.classification !== "in_transit") {
        assertExternalTransferDirection(input.classification, row.amountMinor);
      }
      const clearedResolutions = clearTransferResolutionsInDatabase(transaction, [
        row.id,
      ]);
      let reclassificationJournalEntryId: number | null = null;
      if (input.classification !== "in_transit" && row.sourceJournalEntryId) {
        if (!row.effectiveDate) {
          throw new Error("The accepted transfer is missing its effective date.");
        }
        reclassificationJournalEntryId =
          createExternalTransferReclassificationInDatabase(transaction, {
            amountMinor: row.amountMinor,
            description: row.description,
            effectiveDate: row.effectiveDate,
          });
      }
      transaction
        .insert(importTransferResolutions)
        .values({
          importRowId: row.id,
          classification: input.classification,
          reclassificationJournalEntryId,
        })
        .run();
      recordAuditEvent(transaction, {
        action: "transfer.resolution_saved",
        entityType: "import_row",
        entityId: row.id,
        details: {
          classification: input.classification,
          reclassificationJournalEntryId,
          clearedResolutions,
        },
      });
    },
    { behavior: "immediate" },
  );
}

export async function confirmTransferMatch(input: {
  importRowId: number;
  counterpartImportRowId: number;
}): Promise<void> {
  if (input.importRowId === input.counterpartImportRowId) {
    throw new DomainError("A transfer cannot match itself.");
  }
  const { db } = await getDatabaseContext();
  db.transaction(
    (transaction) => {
      const first = loadTransferRow(transaction, input.importRowId);
      const second = loadTransferRow(transaction, input.counterpartImportRowId);
      if (!first || !second) {
        throw new DomainError("Both transfer legs must be accepted before matching.");
      }
      if (
        first.accountId === second.accountId ||
        first.currency !== second.currency ||
        first.amountMinor !== -second.amountMinor
      ) {
        throw new DomainError(
          "Matched transfers require equal and opposite amounts in different owned accounts with the same currency.",
        );
      }
      assertTransferMatchWindow(first.transactionDate, second.transactionDate);
      const existingMatched = transaction
        .select()
        .from(importTransferResolutions)
        .where(inArray(importTransferResolutions.importRowId, [first.id, second.id]))
        .all()
        .find(
          (resolution) =>
            (resolution.classification === "owned_account" ||
              resolution.classification === "card_payment") &&
            resolution.counterpartImportRowId !==
              (resolution.importRowId === first.id ? second.id : first.id),
        );
      if (existingMatched) {
        throw new DomainError(
          "Clear the existing confirmed transfer match before choosing another counterpart.",
        );
      }
      const classification = inferMatchedTransferClassification(
        financialAccountTypeSchema.parse(first.accountType),
        financialAccountTypeSchema.parse(second.accountType),
      );
      const clearedResolutions = clearTransferResolutionsInDatabase(transaction, [
        first.id,
        second.id,
      ]);
      transaction
        .insert(importTransferResolutions)
        .values([
          {
            importRowId: first.id,
            classification,
            counterpartImportRowId: second.id,
          },
          {
            importRowId: second.id,
            classification,
            counterpartImportRowId: first.id,
          },
        ])
        .run();
      recordAuditEvent(transaction, {
        action: "transfer.match_confirmed",
        entityType: "import_row",
        entityId: first.id,
        details: {
          counterpartImportRowId: second.id,
          classification,
          clearingNetMinor: first.amountMinor + second.amountMinor,
          clearedResolutions,
        },
      });
    },
    { behavior: "immediate" },
  );
}

export async function clearTransferClassification(importRowId: number): Promise<void> {
  const { db } = await getDatabaseContext();
  db.transaction(
    (transaction) => {
      const row = loadTransferRow(transaction, importRowId);
      if (!row) {
        throw new DomainError("The accepted transfer row does not exist.");
      }
      const clearedResolutions = clearTransferResolutionsInDatabase(transaction, [
        row.id,
      ]);
      recordAuditEvent(transaction, {
        action: "transfer.resolution_saved",
        entityType: "import_row",
        entityId: row.id,
        details: { classification: null, clearedResolutions },
      });
    },
    { behavior: "immediate" },
  );
}

export async function getTransferClearingBalance(): Promise<{
  amountMinor: number;
  currency: BaseCurrency | null;
}> {
  const { db } = await getDatabaseContext();
  const result = db
    .select({
      amountMinor: sql<number>`coalesce(sum(${postings.amountMinor}), 0)`,
    })
    .from(postings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(eq(ledgerAccounts.systemKey, "transfer_clearing"))
    .get();
  const settings = db
    .select({ baseCurrency: appSettings.baseCurrency })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .get();
  return {
    amountMinor: Number(result?.amountMinor ?? 0),
    currency: settings ? baseCurrencySchema.parse(settings.baseCurrency) : null,
  };
}

export async function getOutsideScopeTransferBalance(): Promise<{
  amountMinor: number;
  currency: BaseCurrency | null;
}> {
  const { db } = await getDatabaseContext();
  const result = db
    .select({
      amountMinor: sql<number>`coalesce(sum(${postings.amountMinor}), 0)`,
    })
    .from(postings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(eq(ledgerAccounts.systemKey, "outside_scope_transfers"))
    .get();
  const settings = db
    .select({ baseCurrency: appSettings.baseCurrency })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .get();
  return {
    amountMinor: Number(result?.amountMinor ?? 0),
    currency: settings ? baseCurrencySchema.parse(settings.baseCurrency) : null,
  };
}
