import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  categories,
  financialAccounts,
  importBatches,
  importRowJournalEntries,
  importRows,
  importTransferResolutions,
  journalEntries,
  ledgerAccounts,
  postings,
} from "@/db/schema";
import type { AppTransaction } from "@/db/types";
import { calendarDateSchema } from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";
import {
  getRequiredCategoryKind,
  type ManualTransactionKind,
} from "@/domain/transactions";
import { postJournalEntryWithinTransaction } from "@/features/ledger/ledger-service";

type AccountLedger = {
  financialAccountId: number;
  ledgerAccountId: number;
  name: string;
  openingDate: string;
};

function getActiveAccountLedger(
  transaction: AppTransaction,
  financialAccountId: number,
): AccountLedger {
  const account = transaction
    .select({
      financialAccountId: financialAccounts.id,
      ledgerAccountId: ledgerAccounts.id,
      name: financialAccounts.name,
      openingDate: financialAccounts.openingDate,
    })
    .from(financialAccounts)
    .innerJoin(
      ledgerAccounts,
      eq(ledgerAccounts.financialAccountId, financialAccounts.id),
    )
    .where(
      and(
        eq(financialAccounts.id, financialAccountId),
        isNull(financialAccounts.archivedAt),
      ),
    )
    .get();

  if (!account) {
    throw new DomainError("Choose an active financial account.");
  }

  return account;
}

export async function createManualTransaction(input: {
  kind: ManualTransactionKind;
  effectiveDate: string;
  description: string;
  amountMinor: number;
  financialAccountId: number;
  categoryId?: number;
  destinationFinancialAccountId?: number;
  adjustmentDirection?: "increase" | "decrease";
  notes?: string;
}): Promise<number> {
  const { db } = await getDatabaseContext();
  const effectiveDate = calendarDateSchema.parse(input.effectiveDate);
  const description = input.description.trim();

  if (!description) {
    throw new DomainError("Enter a transaction description.");
  }

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new DomainError("Enter an amount greater than zero.");
  }

  return db.transaction((transaction) => {
    const account = getActiveAccountLedger(transaction, input.financialAccountId);

    if (effectiveDate < account.openingDate) {
      throw new DomainError(
        `The transaction date cannot be before ${account.name}'s opening date (${account.openingDate}).`,
      );
    }

    const entryBase = {
      effectiveDate,
      description,
      sourceType: "manual" as const,
      notes: input.notes,
    };

    if (input.kind === "transfer") {
      if (!input.destinationFinancialAccountId) {
        throw new DomainError("Choose a destination account.");
      }

      const destination = getActiveAccountLedger(
        transaction,
        input.destinationFinancialAccountId,
      );

      if (destination.financialAccountId === account.financialAccountId) {
        throw new DomainError("Choose two different accounts for a transfer.");
      }

      if (effectiveDate < destination.openingDate) {
        throw new DomainError(
          `The transaction date cannot be before ${destination.name}'s opening date (${destination.openingDate}).`,
        );
      }

      return postJournalEntryWithinTransaction(transaction, {
        ...entryBase,
        postings: [
          {
            ledgerAccountId: account.ledgerAccountId,
            amountMinor: -input.amountMinor,
            memo: `From ${account.name}`,
          },
          {
            ledgerAccountId: destination.ledgerAccountId,
            amountMinor: input.amountMinor,
            memo: `To ${destination.name}`,
          },
        ],
      });
    }

    if (input.kind === "adjustment") {
      if (
        input.adjustmentDirection !== "increase" &&
        input.adjustmentDirection !== "decrease"
      ) {
        throw new DomainError(
          "Choose whether the adjustment increases or decreases value.",
        );
      }

      if (!input.notes?.trim()) {
        throw new DomainError("Explain why the balance adjustment is needed.");
      }

      const adjustmentAccount = transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.systemKey, "manual_adjustments"))
        .get();

      if (!adjustmentAccount) {
        throw new Error("The manual-adjustment ledger account is missing.");
      }

      const accountAmount =
        input.adjustmentDirection === "increase"
          ? input.amountMinor
          : -input.amountMinor;

      return postJournalEntryWithinTransaction(transaction, {
        ...entryBase,
        postings: [
          {
            ledgerAccountId: account.ledgerAccountId,
            amountMinor: accountAmount,
          },
          {
            ledgerAccountId: adjustmentAccount.id,
            amountMinor: -accountAmount,
          },
        ],
      });
    }

    if (!input.categoryId) {
      throw new DomainError("Choose a category.");
    }

    const category = transaction
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        ledgerAccountId: ledgerAccounts.id,
      })
      .from(categories)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.categoryId, categories.id))
      .where(and(eq(categories.id, input.categoryId), isNull(categories.archivedAt)))
      .get();

    const requiredCategoryKind = getRequiredCategoryKind(input.kind);

    if (
      requiredCategoryKind === null ||
      !category ||
      category.kind !== requiredCategoryKind
    ) {
      throw new DomainError(`Choose an active ${requiredCategoryKind} category.`);
    }

    const accountAmount =
      input.kind === "income" || input.kind === "refund"
        ? input.amountMinor
        : -input.amountMinor;

    return postJournalEntryWithinTransaction(transaction, {
      ...entryBase,
      postings: [
        {
          ledgerAccountId: account.ledgerAccountId,
          amountMinor: accountAmount,
        },
        {
          ledgerAccountId: category.ledgerAccountId,
          amountMinor: -accountAmount,
        },
      ],
    });
  });
}

export type JournalEntryListItem = {
  id: number;
  effectiveDate: string;
  description: string;
  sourceType: string;
  notes: string | null;
  reversesEntryId: number | null;
  reversedByEntryId: number | null;
  importSource: {
    importRowId: number;
    importBatchId: number;
    originalRowNumber: number;
    postedDate: string | null;
    sourceFilename: string;
  } | null;
  postings: Array<{
    id: number;
    amountMinor: number;
    ledgerName: string;
    ledgerKind: string;
    financialAccountName: string | null;
    categoryName: string | null;
    systemKey: string | null;
  }>;
};

export async function listRecentJournalEntries(
  limit = 30,
  offset = 0,
): Promise<JournalEntryListItem[]> {
  const { db } = await getDatabaseContext();
  const entries = db
    .select({
      id: journalEntries.id,
      effectiveDate: journalEntries.effectiveDate,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      notes: journalEntries.notes,
      reversesEntryId: journalEntries.reversesEntryId,
    })
    .from(journalEntries)
    .where(eq(journalEntries.isPosted, true))
    .orderBy(desc(journalEntries.effectiveDate), desc(journalEntries.id))
    .limit(limit)
    .offset(offset)
    .all();

  if (entries.length === 0) {
    return [];
  }

  const entryIds = entries.map((entry) => entry.id);
  const postingRows = db
    .select({
      id: postings.id,
      journalEntryId: postings.journalEntryId,
      amountMinor: postings.amountMinor,
      ledgerName: ledgerAccounts.name,
      ledgerKind: ledgerAccounts.kind,
      financialAccountName: financialAccounts.name,
      categoryName: categories.name,
      systemKey: ledgerAccounts.systemKey,
    })
    .from(postings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .leftJoin(
      financialAccounts,
      eq(financialAccounts.id, ledgerAccounts.financialAccountId),
    )
    .leftJoin(categories, eq(categories.id, ledgerAccounts.categoryId))
    .where(inArray(postings.journalEntryId, entryIds))
    .orderBy(postings.id)
    .all();
  const reversalRows = db
    .select({
      id: journalEntries.id,
      reversesEntryId: journalEntries.reversesEntryId,
    })
    .from(journalEntries)
    .where(inArray(journalEntries.reversesEntryId, entryIds))
    .all();
  const reversalMap = new Map(
    reversalRows.map((entry) => [entry.reversesEntryId!, entry.id]),
  );
  const importSourceRows = db
    .select({
      journalEntryId: importRowJournalEntries.journalEntryId,
      importRowId: importRows.id,
      importBatchId: importBatches.id,
      originalRowNumber: importRows.originalRowNumber,
      postedDate: importRows.postedDate,
      sourceFilename: importBatches.sourceFilename,
    })
    .from(importRowJournalEntries)
    .innerJoin(importRows, eq(importRows.id, importRowJournalEntries.importRowId))
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .where(inArray(importRowJournalEntries.journalEntryId, entryIds))
    .all();
  const importSourceByEntryId = new Map(
    importSourceRows.map(({ journalEntryId, ...source }) => [journalEntryId, source]),
  );
  const sourceLookupEntryIds = [
    ...entryIds,
    ...entries.flatMap((entry) =>
      entry.reversesEntryId === null ? [] : [entry.reversesEntryId],
    ),
  ];
  const transferSourceRows = db
    .select({
      journalEntryId: importTransferResolutions.reclassificationJournalEntryId,
      importRowId: importRows.id,
      importBatchId: importBatches.id,
      originalRowNumber: importRows.originalRowNumber,
      postedDate: importRows.postedDate,
      sourceFilename: importBatches.sourceFilename,
    })
    .from(importTransferResolutions)
    .innerJoin(importRows, eq(importRows.id, importTransferResolutions.importRowId))
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .where(
      inArray(
        importTransferResolutions.reclassificationJournalEntryId,
        sourceLookupEntryIds,
      ),
    )
    .all();
  const transferSourceByEntryId = new Map(
    transferSourceRows.flatMap(({ journalEntryId, ...source }) =>
      journalEntryId === null ? [] : [[journalEntryId, source] as const],
    ),
  );

  return entries.map((entry) => ({
    ...entry,
    reversedByEntryId: reversalMap.get(entry.id) ?? null,
    importSource:
      importSourceByEntryId.get(entry.id) ??
      transferSourceByEntryId.get(entry.id) ??
      (entry.reversesEntryId === null
        ? null
        : (transferSourceByEntryId.get(entry.reversesEntryId) ?? null)),
    postings: postingRows
      .filter((posting) => posting.journalEntryId === entry.id)
      .map((posting) => ({
        id: posting.id,
        amountMinor: posting.amountMinor,
        ledgerName: posting.ledgerName,
        ledgerKind: posting.ledgerKind,
        financialAccountName: posting.financialAccountName,
        categoryName: posting.categoryName,
        systemKey: posting.systemKey,
      })),
  }));
}

export async function countPostedJournalEntries(): Promise<number> {
  const { db } = await getDatabaseContext();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(journalEntries)
    .where(eq(journalEntries.isPosted, true))
    .get();

  return Number(result?.count ?? 0);
}
