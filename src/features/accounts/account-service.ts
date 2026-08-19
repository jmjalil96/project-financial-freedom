import { and, eq, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  financialAccounts,
  importBatches,
  journalEntries,
  ledgerAccounts,
  postings,
} from "@/db/schema";
import {
  financialAccountTypeSchema,
  getFinancialAccountType,
  toLedgerBalance,
  type FinancialAccountType,
} from "@/domain/accounts";
import { calendarDateSchema, getLocalCalendarDate } from "@/domain/calendar-date";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import { sumMinorUnits } from "@/domain/money";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { postJournalEntryWithinTransaction } from "@/features/ledger/ledger-service";
import { findBaseCurrency } from "@/features/settings/settings-repository";

export type FinancialAccount = {
  id: number;
  name: string;
  institution: string | null;
  type: FinancialAccountType;
  currency: BaseCurrency;
  openingDate: string;
  requiredForClose: boolean;
  archivedAt: string | null;
  archivedOn: string | null;
  balanceMinor: number;
};

export async function createFinancialAccount(input: {
  name: string;
  institution?: string;
  type: FinancialAccountType;
  openingDate: string;
  openingBalanceMinor: number;
  requiredForClose: boolean;
}): Promise<number> {
  const { db } = await getDatabaseContext();
  const name = input.name.trim();
  const institution = input.institution?.trim() || null;
  const type = financialAccountTypeSchema.parse(input.type);
  const openingDate = calendarDateSchema.parse(input.openingDate);

  if (!name) {
    throw new DomainError("Enter an account name.");
  }

  if (!Number.isSafeInteger(input.openingBalanceMinor)) {
    throw new DomainError("The opening balance must use integer minor units.");
  }

  return db.transaction((transaction) => {
    const currency = findBaseCurrency(transaction);

    if (!currency) {
      throw new DomainError("Complete currency setup before creating an account.");
    }

    const accountType = getFinancialAccountType(type);
    const accountResult = transaction
      .insert(financialAccounts)
      .values({
        name,
        institution,
        type,
        currency,
        openingDate,
        requiredForClose: input.requiredForClose,
      })
      .run();
    const financialAccountId = Number(accountResult.lastInsertRowid);
    const ledgerResult = transaction
      .insert(ledgerAccounts)
      .values({
        name,
        kind: accountType.ledgerKind,
        financialAccountId,
      })
      .run();
    const ledgerAccountId = Number(ledgerResult.lastInsertRowid);

    recordAuditEvent(transaction, {
      action: "account.created",
      entityType: "financial_account",
      entityId: financialAccountId,
      details: {
        name,
        type,
        currency,
        openingDate,
        requiredForClose: input.requiredForClose,
      },
    });

    if (input.openingBalanceMinor !== 0) {
      const openingEquity = transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.systemKey, "opening_equity"))
        .get();

      if (!openingEquity) {
        throw new Error("The opening-equity ledger account is missing.");
      }

      const accountPosting = toLedgerBalance(type, input.openingBalanceMinor);

      postJournalEntryWithinTransaction(transaction, {
        effectiveDate: openingDate,
        description: `Opening balance — ${name}`,
        sourceType: "opening_balance",
        notes: "Established when the account was created.",
        postings: [
          {
            ledgerAccountId,
            amountMinor: accountPosting,
          },
          {
            ledgerAccountId: openingEquity.id,
            amountMinor: -accountPosting,
          },
        ],
      });
    }

    return financialAccountId;
  });
}

export async function listFinancialAccounts(): Promise<FinancialAccount[]> {
  const { db } = await getDatabaseContext();
  const rows = db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      institution: financialAccounts.institution,
      type: financialAccounts.type,
      currency: financialAccounts.currency,
      openingDate: financialAccounts.openingDate,
      requiredForClose: financialAccounts.requiredForClose,
      archivedAt: financialAccounts.archivedAt,
      archivedOn: financialAccounts.archivedOn,
      balanceMinor: sql<number>`coalesce(sum(case when ${journalEntries.isPosted} = 1 then ${postings.amountMinor} else 0 end), 0)`,
    })
    .from(financialAccounts)
    .innerJoin(
      ledgerAccounts,
      eq(ledgerAccounts.financialAccountId, financialAccounts.id),
    )
    .leftJoin(postings, eq(postings.ledgerAccountId, ledgerAccounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .groupBy(financialAccounts.id, ledgerAccounts.id)
    .orderBy(financialAccounts.archivedAt, financialAccounts.createdAt)
    .all();

  return rows.map((row) => {
    const balanceMinor = Number(row.balanceMinor);
    sumMinorUnits([balanceMinor], "An account balance exceeds the safe money range.");

    return {
      ...row,
      type: financialAccountTypeSchema.parse(row.type),
      currency: baseCurrencySchema.parse(row.currency),
      balanceMinor,
    };
  });
}

export async function archiveFinancialAccount(
  financialAccountId: number,
  archivedOnInput?: string,
): Promise<void> {
  const { db } = await getDatabaseContext();
  const today = getLocalCalendarDate();
  const archivedOn = calendarDateSchema.parse(archivedOnInput ?? today);

  if (archivedOn > today) {
    throw new DomainError("The account closing date cannot be in the future.");
  }

  db.transaction((transaction) => {
    const account = transaction
      .select({
        id: financialAccounts.id,
        name: financialAccounts.name,
        openingDate: financialAccounts.openingDate,
        archivedAt: financialAccounts.archivedAt,
        ledgerAccountId: ledgerAccounts.id,
      })
      .from(financialAccounts)
      .innerJoin(
        ledgerAccounts,
        eq(ledgerAccounts.financialAccountId, financialAccounts.id),
      )
      .where(eq(financialAccounts.id, financialAccountId))
      .get();

    if (!account) {
      throw new DomainError("The account does not exist.");
    }

    if (account.archivedAt) {
      return;
    }

    if (archivedOn < account.openingDate) {
      throw new DomainError(
        `The account closing date cannot be before its opening date (${account.openingDate}).`,
      );
    }

    const unpostedImport = transaction
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.financialAccountId, account.id),
          sql`${importBatches.ledgerPostedAt} IS NULL`,
        ),
      )
      .get();

    if (unpostedImport) {
      throw new DomainError(
        "Review, finalize, and post every imported statement for this account before archiving it.",
      );
    }

    const balance = transaction
      .select({
        amountMinor: sql<number>`coalesce(sum(${postings.amountMinor}), 0)`,
      })
      .from(postings)
      .innerJoin(
        journalEntries,
        and(
          eq(journalEntries.id, postings.journalEntryId),
          eq(journalEntries.isPosted, true),
        ),
      )
      .where(eq(postings.ledgerAccountId, account.ledgerAccountId))
      .get();

    if (Number(balance?.amountMinor ?? 0) !== 0) {
      throw new DomainError("Bring the account balance to zero before archiving it.");
    }

    const latestActivity = transaction
      .select({
        effectiveDate: sql<string | null>`max(${journalEntries.effectiveDate})`,
      })
      .from(postings)
      .innerJoin(
        journalEntries,
        and(
          eq(journalEntries.id, postings.journalEntryId),
          eq(journalEntries.isPosted, true),
        ),
      )
      .where(eq(postings.ledgerAccountId, account.ledgerAccountId))
      .get()?.effectiveDate;

    if (latestActivity && archivedOn < latestActivity) {
      throw new DomainError(
        `The account closing date cannot be before its latest ledger activity (${latestActivity}).`,
      );
    }

    transaction
      .update(financialAccounts)
      .set({
        archivedAt: sql`CURRENT_TIMESTAMP`,
        archivedOn,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(financialAccounts.id, financialAccountId))
      .run();

    recordAuditEvent(transaction, {
      action: "account.archived",
      entityType: "financial_account",
      entityId: financialAccountId,
      details: {
        name: account.name,
        archivedOn,
      },
    });
  });
}

export async function restoreFinancialAccount(
  financialAccountId: number,
): Promise<void> {
  const { db } = await getDatabaseContext();

  db.transaction((transaction) => {
    const account = transaction
      .select({
        id: financialAccounts.id,
        name: financialAccounts.name,
        archivedAt: financialAccounts.archivedAt,
      })
      .from(financialAccounts)
      .where(eq(financialAccounts.id, financialAccountId))
      .get();

    if (!account) {
      throw new DomainError("The account does not exist.");
    }

    if (!account.archivedAt) {
      return;
    }

    transaction
      .update(financialAccounts)
      .set({
        archivedAt: null,
        archivedOn: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(financialAccounts.id, financialAccountId))
      .run();

    recordAuditEvent(transaction, {
      action: "account.restored",
      entityType: "financial_account",
      entityId: financialAccountId,
      details: {
        name: account.name,
      },
    });
  });
}
