import { eq, inArray, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  categories,
  financialAccounts,
  importRowJournalEntries,
  importTransferResolutions,
  journalEntries,
  ledgerAccounts,
  postings,
} from "@/db/schema";
import type { AppTransaction } from "@/db/types";
import { calendarDateSchema } from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";
import { sumMinorUnits } from "@/domain/money";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { assertLifecycleChangeOpenInDatabase } from "@/features/month-close/month-lock-service";

export type JournalSourceType = "import" | "manual" | "opening_balance" | "system";

export type PostingInput = {
  ledgerAccountId: number;
  amountMinor: number;
  memo?: string;
};

export type JournalEntryInput = {
  effectiveDate: string;
  description: string;
  sourceType: JournalSourceType;
  notes?: string;
  reversesEntryId?: number;
  importSourceRowId?: number;
  postings: PostingInput[];
};

function normalizePostings(input: PostingInput[]): PostingInput[] {
  const totals = new Map<
    number,
    {
      amountMinor: number;
      memo?: string;
    }
  >();

  for (const posting of input) {
    if (
      !Number.isSafeInteger(posting.ledgerAccountId) ||
      posting.ledgerAccountId <= 0
    ) {
      throw new DomainError("Every posting requires a valid ledger account.");
    }

    if (!Number.isSafeInteger(posting.amountMinor)) {
      throw new DomainError("Every posting amount must use safe integer minor units.");
    }

    const prior = totals.get(posting.ledgerAccountId);
    const amountMinor = (prior?.amountMinor ?? 0) + posting.amountMinor;

    if (!Number.isSafeInteger(amountMinor)) {
      throw new DomainError("The combined posting amount is too large.");
    }

    totals.set(posting.ledgerAccountId, {
      amountMinor,
      memo: prior?.memo ?? posting.memo,
    });
  }

  return [...totals.entries()]
    .filter(([, posting]) => posting.amountMinor !== 0)
    .map(([ledgerAccountId, posting]) => ({
      ledgerAccountId,
      amountMinor: posting.amountMinor,
      memo: posting.memo,
    }));
}

export function postJournalEntryWithinTransaction(
  transaction: AppTransaction,
  input: JournalEntryInput,
): number {
  const effectiveDate = calendarDateSchema.parse(input.effectiveDate);
  const description = input.description.trim();
  const normalizedPostings = normalizePostings(input.postings);

  if (!description) {
    throw new DomainError("A journal entry requires a description.");
  }

  assertLifecycleChangeOpenInDatabase(
    transaction,
    effectiveDate,
    "posting or correcting ledger activity",
  );
  if ((input.sourceType === "import") !== (input.importSourceRowId !== undefined)) {
    throw new DomainError(
      "Imported journal entries require exactly one imported source row.",
    );
  }

  if (normalizedPostings.length < 2) {
    throw new DomainError("A journal entry requires at least two nonzero postings.");
  }

  const total = sumMinorUnits(
    normalizedPostings.map((posting) => posting.amountMinor),
    "The combined journal entry amount is too large.",
  );

  if (total !== 0) {
    throw new DomainError("Journal entry postings must balance exactly to zero.");
  }

  const ledgerAccountIds = normalizedPostings.map((posting) => posting.ledgerAccountId);
  const existingLedgerAccounts = transaction
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.id, ledgerAccountIds))
    .all();

  if (existingLedgerAccounts.length !== ledgerAccountIds.length) {
    throw new DomainError("One or more ledger accounts do not exist.");
  }

  const result = transaction
    .insert(journalEntries)
    .values({
      effectiveDate,
      description,
      sourceType: input.sourceType,
      notes: input.notes?.trim() || null,
      reversesEntryId: input.reversesEntryId,
    })
    .run();
  const journalEntryId = Number(result.lastInsertRowid);

  if (input.importSourceRowId !== undefined) {
    transaction
      .insert(importRowJournalEntries)
      .values({
        importRowId: input.importSourceRowId,
        journalEntryId,
      })
      .run();
  }

  transaction
    .insert(postings)
    .values(
      normalizedPostings.map((posting) => ({
        journalEntryId,
        ledgerAccountId: posting.ledgerAccountId,
        amountMinor: posting.amountMinor,
        memo: posting.memo?.trim() || null,
      })),
    )
    .run();

  transaction
    .update(journalEntries)
    .set({
      isPosted: true,
      postedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(journalEntries.id, journalEntryId))
    .run();

  recordAuditEvent(transaction, {
    action: input.reversesEntryId ? "journal.reversed" : "journal.posted",
    entityType: "journal_entry",
    entityId: journalEntryId,
    details: {
      effectiveDate,
      sourceType: input.sourceType,
      postingCount: normalizedPostings.length,
      reversesEntryId: input.reversesEntryId ?? null,
    },
  });

  return journalEntryId;
}

export async function postJournalEntry(input: JournalEntryInput): Promise<number> {
  const { db } = await getDatabaseContext();

  return db.transaction((transaction) =>
    postJournalEntryWithinTransaction(transaction, input),
  );
}

export async function reverseJournalEntry(input: {
  journalEntryId: number;
  reason: string;
}): Promise<number> {
  const { db } = await getDatabaseContext();
  const reason = input.reason.trim();

  if (!reason) {
    throw new DomainError("A reversal requires a reason.");
  }

  return db.transaction((transaction) => {
    const entry = transaction
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, input.journalEntryId))
      .get();

    if (!entry?.isPosted) {
      throw new DomainError("Only a posted journal entry can be reversed.");
    }

    if (entry.reversesEntryId !== null) {
      throw new DomainError(
        "A reversal entry cannot be reversed. Post a documented replacement entry instead.",
      );
    }

    const transferResolution = transaction
      .select({ id: importTransferResolutions.id })
      .from(importTransferResolutions)
      .leftJoin(
        importRowJournalEntries,
        eq(importRowJournalEntries.importRowId, importTransferResolutions.importRowId),
      )
      .where(
        sql`${importTransferResolutions.reclassificationJournalEntryId} = ${entry.id}
          OR ${importRowJournalEntries.journalEntryId} = ${entry.id}`,
      )
      .get();

    if (transferResolution) {
      throw new DomainError(
        "Change or clear the transfer resolution before reversing this entry so its explanation remains consistent.",
      );
    }

    const existingReversal = transaction
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.reversesEntryId, input.journalEntryId))
      .get();

    if (existingReversal) {
      throw new DomainError("This journal entry has already been reversed.");
    }

    const originalPostings = transaction
      .select({
        ledgerAccountId: postings.ledgerAccountId,
        amountMinor: postings.amountMinor,
        memo: postings.memo,
      })
      .from(postings)
      .where(eq(postings.journalEntryId, input.journalEntryId))
      .all();
    const archivedAccount = transaction
      .select({
        name: financialAccounts.name,
        archivedAt: financialAccounts.archivedAt,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
      .innerJoin(
        financialAccounts,
        eq(financialAccounts.id, ledgerAccounts.financialAccountId),
      )
      .where(eq(postings.journalEntryId, input.journalEntryId))
      .all()
      .find((account) => account.archivedAt !== null);

    if (archivedAccount) {
      throw new DomainError(
        `Restore ${archivedAccount.name} before reversing this entry so its balance remains visible and correctable.`,
      );
    }

    const archivedCategory = transaction
      .select({
        name: categories.name,
        archivedAt: categories.archivedAt,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
      .innerJoin(categories, eq(categories.id, ledgerAccounts.categoryId))
      .where(eq(postings.journalEntryId, input.journalEntryId))
      .all()
      .find((category) => category.archivedAt !== null);

    if (archivedCategory) {
      throw new DomainError(
        `Restore ${archivedCategory.name} before reversing this entry so the correction remains classifiable.`,
      );
    }

    return postJournalEntryWithinTransaction(transaction, {
      effectiveDate: entry.effectiveDate,
      description: `Reversal: ${entry.description}`,
      sourceType: "system",
      notes: reason,
      reversesEntryId: entry.id,
      postings: originalPostings.map((posting) => ({
        ledgerAccountId: posting.ledgerAccountId,
        amountMinor: -posting.amountMinor,
        memo: posting.memo ?? undefined,
      })),
    });
  });
}
