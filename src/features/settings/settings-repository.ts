import { sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  appSettings,
  financialAccounts,
  importBatches,
  journalEntries,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import { recordAuditEvent } from "@/features/audit/audit-service";

export type ApplicationSettings = {
  baseCurrency: BaseCurrency;
  createdAt: string;
  updatedAt: string;
};

export function findBaseCurrency(
  database: AppDatabase | AppTransaction,
): BaseCurrency | null {
  const settings = database
    .select({ baseCurrency: appSettings.baseCurrency })
    .from(appSettings)
    .limit(1)
    .get();

  return settings ? baseCurrencySchema.parse(settings.baseCurrency) : null;
}

function hasFinancialData(transaction: AppTransaction): boolean {
  const account = transaction
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .limit(1)
    .get();
  const journalEntry = transaction
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .limit(1)
    .get();
  const importBatch = transaction
    .select({ id: importBatches.id })
    .from(importBatches)
    .limit(1)
    .get();

  return Boolean(account || journalEntry || importBatch);
}

export async function getApplicationSettings(): Promise<ApplicationSettings | null> {
  const { db } = await getDatabaseContext();
  const settings = db.select().from(appSettings).limit(1).get();

  if (!settings) {
    return null;
  }

  return {
    baseCurrency: baseCurrencySchema.parse(settings.baseCurrency),
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

export async function saveBaseCurrency(baseCurrency: BaseCurrency): Promise<void> {
  const { db } = await getDatabaseContext();

  db.transaction((transaction) => {
    const existing = transaction.select().from(appSettings).limit(1).get();
    const financialDataExists = hasFinancialData(transaction);

    if (!existing && financialDataExists) {
      throw new DomainError(
        "Base currency settings are missing while financial data exists. Restore a valid backup before continuing.",
      );
    }

    if (existing && existing.baseCurrency !== baseCurrency && financialDataExists) {
      throw new DomainError(
        "Base currency cannot be changed after financial data has been created.",
      );
    }

    transaction
      .insert(appSettings)
      .values({
        id: 1,
        baseCurrency,
      })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: {
          baseCurrency,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();

    if (!existing || existing.baseCurrency !== baseCurrency) {
      recordAuditEvent(transaction, {
        action: existing
          ? "settings.base_currency_changed"
          : "settings.base_currency_initialized",
        entityType: "application_settings",
        entityId: 1,
        details: {
          previousBaseCurrency: existing?.baseCurrency ?? null,
          baseCurrency,
        },
      });
    }
  });
}

export async function canChangeBaseCurrency(): Promise<boolean> {
  const { db } = await getDatabaseContext();

  return db.transaction((transaction) => !hasFinancialData(transaction));
}
