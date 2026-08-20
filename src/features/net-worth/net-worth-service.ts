import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import {
  financialAccounts,
  importBatches,
  importRows,
  importTransferResolutions,
  journalEntries,
  ledgerAccounts,
  manualItems,
  manualItemValuations,
  postings,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import { financialAccountTypeSchema, isLiabilityAccount } from "@/domain/accounts";
import {
  calendarDateSchema,
  getCalendarMonthBounds,
  getLocalCalendarDate,
} from "@/domain/calendar-date";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import { sumMinorUnits } from "@/domain/money";
import {
  isValuationStale,
  manualItemKinds,
  normalizeManualItemName,
  shiftCalendarMonth,
  toNaturalManualValue,
  toSignedManualValue,
  valuationFrequencies,
  type ManualItemKind,
  type ValuationFrequency,
} from "@/domain/net-worth";
import { recordAuditEvent } from "@/features/audit/audit-service";
import { assertLifecycleChangeOpenInDatabase } from "@/features/month-close/month-lock-service";
import { createDatabaseBackup } from "@/server/database-backup";

type ManualItemRow = typeof manualItems.$inferSelect;
type ValuationRow = typeof manualItemValuations.$inferSelect;

export type ManualValuationView = {
  id: number;
  effectiveDate: string;
  valueMinor: number;
  naturalValueMinor: number;
  sourceNote: string;
  origin: "manual" | "imported";
  carriedForwardFromValuationId: number | null;
  supersedesValuationId: number | null;
  isSuperseded: boolean;
  createdAt: string;
};

export type ManualItemView = {
  id: number;
  name: string;
  description: string | null;
  kind: ManualItemKind;
  openingDate: string;
  valuationFrequency: ValuationFrequency;
  archivedAt: string | null;
  archivedOn: string | null;
  latestValuation: ManualValuationView | null;
  valuationHistory: ManualValuationView[];
  valuationCount: number;
  isApplicable: boolean;
  isStale: boolean;
};

export type NetWorthComponent = {
  key: string;
  name: string;
  kind: "asset" | "liability" | "transfer_clearing" | "outside_scope";
  amountMinor: number;
  source:
    | { type: "ledger_account"; financialAccountId: number }
    | { type: "system_ledger"; systemKey: string }
    | {
        type: "manual_valuation";
        manualItemId: number;
        valuationId: number;
        valuationDate: string;
        sourceNote: string;
        origin: "manual" | "imported";
        carriedForward: boolean;
      };
};

export type NetWorthSnapshot = {
  targetMonth: string;
  monthEnd: string;
  currency: BaseCurrency;
  netWorthMinor: number;
  previousMonth: string;
  previousNetWorthMinor: number;
  changeMinor: number;
  debtMinor: number;
  previousDebtMinor: number;
  debtChangeMinor: number;
  components: NetWorthComponent[];
  manualItems: ManualItemView[];
  missingValuationCount: number;
  staleValuationCount: number;
  linkedOutsideScopeMinor: number;
  unlinkedOutsideScopeMinor: number;
};

export type OutsideScopeTransferAssignment = {
  resolutionId: number;
  importRowId: number;
  description: string;
  effectiveDate: string;
  amountMinor: number;
  currency: BaseCurrency;
  accountName: string;
  manualItemId: number | null;
  manualItemName: string | null;
};

function parseManualItemKind(value: string): ManualItemKind {
  if ((manualItemKinds as readonly string[]).includes(value)) {
    return value as ManualItemKind;
  }
  throw new Error(`Unknown manual item kind: ${value}`);
}

function parseValuationFrequency(value: string): ValuationFrequency {
  if ((valuationFrequencies as readonly string[]).includes(value)) {
    return value as ValuationFrequency;
  }
  throw new Error(`Unknown valuation frequency: ${value}`);
}

function currentValuations(
  valuations: readonly ValuationRow[],
  monthEnd?: string,
): ValuationRow[] {
  const candidates = monthEnd
    ? valuations.filter((valuation) => valuation.effectiveDate <= monthEnd)
    : [...valuations];
  const supersededIds = new Set(
    candidates.flatMap((valuation) =>
      valuation.supersedesValuationId === null ? [] : [valuation.supersedesValuationId],
    ),
  );
  return candidates.filter((valuation) => !supersededIds.has(valuation.id));
}

function latestValuationByItem(
  valuations: readonly ValuationRow[],
  monthEnd: string,
): Map<number, ValuationRow> {
  const result = new Map<number, ValuationRow>();
  for (const valuation of currentValuations(valuations, monthEnd).sort((left, right) =>
    left.effectiveDate === right.effectiveDate
      ? left.id - right.id
      : left.effectiveDate.localeCompare(right.effectiveDate),
  )) {
    result.set(valuation.manualItemId, valuation);
  }
  return result;
}

function isManualItemApplicable(item: ManualItemRow, monthEnd: string): boolean {
  return (
    item.openingDate <= monthEnd &&
    (item.archivedOn === null || item.archivedOn >= monthEnd)
  );
}

function valuationView(
  valuation: ValuationRow,
  kind: ManualItemKind,
  isSuperseded = false,
): ManualValuationView {
  return {
    id: valuation.id,
    effectiveDate: valuation.effectiveDate,
    valueMinor: valuation.valueMinor,
    naturalValueMinor: toNaturalManualValue(kind, valuation.valueMinor),
    sourceNote: valuation.sourceNote,
    origin: valuation.origin === "imported" ? "imported" : "manual",
    carriedForwardFromValuationId: valuation.carriedForwardFromValuationId,
    supersedesValuationId: valuation.supersedesValuationId,
    isSuperseded,
    createdAt: valuation.createdAt,
  };
}

function buildSnapshotInDatabase(
  database: AppDatabase | AppTransaction,
  targetMonth: string,
  includeManualItemViews: boolean,
): Omit<
  NetWorthSnapshot,
  | "previousMonth"
  | "previousNetWorthMinor"
  | "changeMinor"
  | "previousDebtMinor"
  | "debtChangeMinor"
> {
  const { end: monthEnd } = getCalendarMonthBounds(targetMonth);
  const settings = database.query.appSettings
    .findFirst({
      where: (table, { eq: equals }) => equals(table.id, 1),
    })
    .sync();
  if (!settings) {
    throw new DomainError("Complete currency setup before viewing net worth.");
  }
  const currency = baseCurrencySchema.parse(settings.baseCurrency);
  const accountRows = database
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      type: financialAccounts.type,
      amountMinor: sql<number>`coalesce(sum(case
        when ${journalEntries.isPosted} = 1
          and ${journalEntries.effectiveDate} <= ${monthEnd}
        then ${postings.amountMinor} else 0 end), 0)`,
    })
    .from(financialAccounts)
    .innerJoin(
      ledgerAccounts,
      eq(ledgerAccounts.financialAccountId, financialAccounts.id),
    )
    .leftJoin(postings, eq(postings.ledgerAccountId, ledgerAccounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .where(
      and(
        sql`${financialAccounts.openingDate} <= ${monthEnd}`,
        or(
          isNull(financialAccounts.archivedOn),
          sql`${financialAccounts.archivedOn} >= ${monthEnd}`,
        ),
      ),
    )
    .groupBy(financialAccounts.id, ledgerAccounts.id)
    .all();
  const itemRows = database.select().from(manualItems).orderBy(manualItems.name).all();
  const itemById = new Map(itemRows.map((item) => [item.id, item]));
  const valuationRows = database
    .select()
    .from(manualItemValuations)
    .orderBy(manualItemValuations.effectiveDate, manualItemValuations.id)
    .all();
  const latestByItem = latestValuationByItem(valuationRows, monthEnd);
  const supersededValuationIds = new Set(
    valuationRows.flatMap((valuation) =>
      valuation.supersedesValuationId === null ? [] : [valuation.supersedesValuationId],
    ),
  );
  const systemRows = database
    .select({
      systemKey: ledgerAccounts.systemKey,
      amountMinor: sql<number>`coalesce(sum(case
        when ${journalEntries.isPosted} = 1
          and ${journalEntries.effectiveDate} <= ${monthEnd}
        then ${postings.amountMinor} else 0 end), 0)`,
    })
    .from(ledgerAccounts)
    .leftJoin(postings, eq(postings.ledgerAccountId, ledgerAccounts.id))
    .leftJoin(journalEntries, eq(journalEntries.id, postings.journalEntryId))
    .where(
      inArray(ledgerAccounts.systemKey, [
        "transfer_clearing",
        "outside_scope_transfers",
      ]),
    )
    .groupBy(ledgerAccounts.id)
    .all();
  const rawOutsideScopeMinor = Number(
    systemRows.find((row) => row.systemKey === "outside_scope_transfers")
      ?.amountMinor ?? 0,
  );
  const linkedOutsideRows = database
    .select({
      manualItemId: importTransferResolutions.manualItemId,
      amountMinor: postings.amountMinor,
      effectiveDate: journalEntries.effectiveDate,
    })
    .from(importTransferResolutions)
    .innerJoin(
      journalEntries,
      eq(journalEntries.id, importTransferResolutions.reclassificationJournalEntryId),
    )
    .innerJoin(postings, eq(postings.journalEntryId, journalEntries.id))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.ledgerAccountId))
    .where(
      and(
        sql`${importTransferResolutions.manualItemId} IS NOT NULL`,
        eq(ledgerAccounts.systemKey, "outside_scope_transfers"),
        sql`${journalEntries.effectiveDate} <= ${monthEnd}`,
      ),
    )
    .all();
  const linkedOutsideScopeMinor = sumMinorUnits(
    linkedOutsideRows
      .filter((row) => {
        if (row.manualItemId === null || !latestByItem.has(row.manualItemId)) {
          return false;
        }
        const item = itemById.get(row.manualItemId);
        return item ? isManualItemApplicable(item, monthEnd) : false;
      })
      .map((row) => Number(row.amountMinor)),
    "The linked outside-scope transfer balance is too large.",
  );
  const unlinkedOutsideScopeMinor = rawOutsideScopeMinor - linkedOutsideScopeMinor;
  const components: NetWorthComponent[] = accountRows.map((account) => {
    const type = financialAccountTypeSchema.parse(account.type);
    return {
      key: `account-${account.id}`,
      name: account.name,
      kind: isLiabilityAccount(type) ? "liability" : "asset",
      amountMinor: Number(account.amountMinor),
      source: { type: "ledger_account", financialAccountId: account.id },
    };
  });
  const transferClearingMinor = Number(
    systemRows.find((row) => row.systemKey === "transfer_clearing")?.amountMinor ?? 0,
  );
  if (transferClearingMinor !== 0) {
    components.push({
      key: "system-transfer-clearing",
      name: "Transfers in transit",
      kind: "transfer_clearing",
      amountMinor: transferClearingMinor,
      source: { type: "system_ledger", systemKey: "transfer_clearing" },
    });
  }
  if (unlinkedOutsideScopeMinor !== 0) {
    components.push({
      key: "system-outside-scope",
      name: "Owned accounts outside this workspace",
      kind: "outside_scope",
      amountMinor: unlinkedOutsideScopeMinor,
      source: {
        type: "system_ledger",
        systemKey: "outside_scope_transfers",
      },
    });
  }
  const manualItemViews: ManualItemView[] = [];
  let missingValuationCount = 0;
  let staleValuationCount = 0;
  for (const item of itemRows) {
    const kind = parseManualItemKind(item.kind);
    const frequency = parseValuationFrequency(item.valuationFrequency);
    const valuation = latestByItem.get(item.id) ?? null;
    const isApplicable = isManualItemApplicable(item, monthEnd);
    const isStale =
      valuation !== null &&
      isValuationStale({
        valuationDate: valuation.effectiveDate,
        monthEnd,
        frequency,
      });
    if (isApplicable && !valuation) {
      missingValuationCount += 1;
    }
    if (isApplicable && isStale) {
      staleValuationCount += 1;
    }
    if (isApplicable && valuation) {
      components.push({
        key: `manual-item-${item.id}`,
        name: item.name,
        kind,
        amountMinor: valuation.valueMinor,
        source: {
          type: "manual_valuation",
          manualItemId: item.id,
          valuationId: valuation.id,
          valuationDate: valuation.effectiveDate,
          sourceNote: valuation.sourceNote,
          origin: valuation.origin === "imported" ? "imported" : "manual",
          carriedForward: valuation.carriedForwardFromValuationId !== null,
        },
      });
    }
    if (includeManualItemViews) {
      const valuationHistory = valuationRows
        .filter((candidate) => candidate.manualItemId === item.id)
        .sort((left, right) =>
          left.effectiveDate === right.effectiveDate
            ? right.id - left.id
            : right.effectiveDate.localeCompare(left.effectiveDate),
        )
        .map((candidate) =>
          valuationView(candidate, kind, supersededValuationIds.has(candidate.id)),
        );
      manualItemViews.push({
        id: item.id,
        name: item.name,
        description: item.description,
        kind,
        openingDate: item.openingDate,
        valuationFrequency: frequency,
        archivedAt: item.archivedAt,
        archivedOn: item.archivedOn,
        latestValuation: valuation ? valuationView(valuation, kind) : null,
        valuationHistory,
        valuationCount: valuationHistory.length,
        isApplicable,
        isStale,
      });
    }
  }
  const netWorthMinor = sumMinorUnits(
    components.map((component) => component.amountMinor),
    "The net-worth total is too large.",
  );
  const debtMinor = sumMinorUnits(
    components
      .filter((component) => component.kind === "liability")
      .map((component) => Math.max(-component.amountMinor, 0)),
    "The debt total is too large.",
  );
  return {
    targetMonth,
    monthEnd,
    currency,
    netWorthMinor,
    debtMinor,
    components,
    manualItems: manualItemViews,
    missingValuationCount,
    staleValuationCount,
    linkedOutsideScopeMinor,
    unlinkedOutsideScopeMinor,
  };
}

export function getNetWorthSnapshotInDatabase(
  database: AppDatabase | AppTransaction,
  targetMonth: string,
  includeManualItemViews = true,
): NetWorthSnapshot {
  const current = buildSnapshotInDatabase(
    database,
    targetMonth,
    includeManualItemViews,
  );
  const previousMonth = shiftCalendarMonth(targetMonth, -1);
  const previous = buildSnapshotInDatabase(database, previousMonth, false);
  return {
    ...current,
    previousMonth,
    previousNetWorthMinor: previous.netWorthMinor,
    changeMinor: current.netWorthMinor - previous.netWorthMinor,
    previousDebtMinor: previous.debtMinor,
    debtChangeMinor: current.debtMinor - previous.debtMinor,
  };
}

export async function getNetWorthSnapshot(
  targetMonth: string,
): Promise<NetWorthSnapshot> {
  const { db } = await getDatabaseContext();
  return getNetWorthSnapshotInDatabase(db, targetMonth);
}

export async function createManualItem(input: {
  name: string;
  description?: string;
  kind: ManualItemKind;
  openingDate: string;
  valuationFrequency: ValuationFrequency;
}): Promise<number> {
  const { db } = await getDatabaseContext();
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  const openingDate = calendarDateSchema.parse(input.openingDate);
  if (!name) {
    throw new DomainError("Enter a manual item name.");
  }
  if (!(manualItemKinds as readonly string[]).includes(input.kind)) {
    throw new DomainError("Choose whether the manual item is an asset or liability.");
  }
  if (!(valuationFrequencies as readonly string[]).includes(input.valuationFrequency)) {
    throw new DomainError("Choose a valid valuation frequency.");
  }
  const normalizedName = normalizeManualItemName(name);
  return db.transaction((transaction) => {
    assertLifecycleChangeOpenInDatabase(
      transaction,
      openingDate,
      "starting this manual item's history",
    );
    const accountConflict = transaction
      .select({ name: financialAccounts.name })
      .from(financialAccounts)
      .all()
      .find((account) => normalizeManualItemName(account.name) === normalizedName);
    if (accountConflict) {
      throw new DomainError(
        `${accountConflict.name} is already tracked as a financial account. Use one tracking method for each financial item.`,
      );
    }
    const result = transaction
      .insert(manualItems)
      .values({
        name,
        normalizedName,
        description,
        kind: input.kind,
        openingDate,
        valuationFrequency: input.valuationFrequency,
      })
      .run();
    const manualItemId = Number(result.lastInsertRowid);
    recordAuditEvent(transaction, {
      action: "manual_item.created",
      entityType: "manual_item",
      entityId: manualItemId,
      details: {
        name,
        kind: input.kind,
        openingDate,
        valuationFrequency: input.valuationFrequency,
      },
    });
    return manualItemId;
  });
}

function loadActiveManualItem(
  transaction: AppTransaction,
  manualItemId: number,
): ManualItemRow {
  const item = transaction
    .select()
    .from(manualItems)
    .where(and(eq(manualItems.id, manualItemId), isNull(manualItems.archivedAt)))
    .get();
  if (!item) {
    throw new DomainError("Choose an active manual asset or liability.");
  }
  return item;
}

export async function recordManualValuation(input: {
  manualItemId: number;
  effectiveDate: string;
  naturalValueMinor: number;
  sourceNote: string;
}): Promise<number> {
  const { db, paths, raw } = await getDatabaseContext();
  const effectiveDate = calendarDateSchema.parse(input.effectiveDate);
  const sourceNote = input.sourceNote.trim();
  if (effectiveDate > getLocalCalendarDate()) {
    throw new DomainError("A valuation date cannot be in the future.");
  }
  if (!sourceNote) {
    throw new DomainError("Record where this valuation came from.");
  }
  const existingOnDate = currentValuations(
    db
      .select()
      .from(manualItemValuations)
      .where(eq(manualItemValuations.manualItemId, input.manualItemId))
      .all(),
  ).some((valuation) => valuation.effectiveDate === effectiveDate);
  if (existingOnDate) {
    await createDatabaseBackup(raw, paths, "pre-correction");
  }
  return db.transaction((transaction) => {
    const item = loadActiveManualItem(transaction, input.manualItemId);
    assertLifecycleChangeOpenInDatabase(
      transaction,
      effectiveDate,
      "recording or correcting a manual valuation",
    );
    if (effectiveDate < item.openingDate) {
      throw new DomainError(
        `The valuation date cannot be before tracking began (${item.openingDate}).`,
      );
    }
    const kind = parseManualItemKind(item.kind);
    const valueMinor = toSignedManualValue(kind, input.naturalValueMinor);
    const valuations = transaction
      .select()
      .from(manualItemValuations)
      .where(eq(manualItemValuations.manualItemId, item.id))
      .all();
    const sameDateCurrent = currentValuations(valuations).find(
      (valuation) => valuation.effectiveDate === effectiveDate,
    );
    const result = transaction
      .insert(manualItemValuations)
      .values({
        manualItemId: item.id,
        effectiveDate,
        valueMinor,
        sourceNote,
        origin: "manual",
        supersedesValuationId: sameDateCurrent?.id ?? null,
      })
      .run();
    const valuationId = Number(result.lastInsertRowid);
    recordAuditEvent(transaction, {
      action: "manual_item.valuation_recorded",
      entityType: "manual_item_valuation",
      entityId: valuationId,
      details: {
        manualItemId: item.id,
        effectiveDate,
        valueMinor,
        origin: "manual",
        supersedesValuationId: sameDateCurrent?.id ?? null,
      },
    });
    return valuationId;
  });
}

export async function carryForwardManualValuation(input: {
  manualItemId: number;
  sourceValuationId: number;
  effectiveDate: string;
  acknowledgment: string;
}): Promise<number> {
  const { db, paths, raw } = await getDatabaseContext();
  const effectiveDate = calendarDateSchema.parse(input.effectiveDate);
  const acknowledgment = input.acknowledgment.trim();
  if (effectiveDate > getLocalCalendarDate()) {
    throw new DomainError("A carry-forward date cannot be in the future.");
  }
  if (!acknowledgment) {
    throw new DomainError("Explain why the prior value is still appropriate.");
  }
  const existingOnDate = currentValuations(
    db
      .select()
      .from(manualItemValuations)
      .where(eq(manualItemValuations.manualItemId, input.manualItemId))
      .all(),
  ).some((valuation) => valuation.effectiveDate === effectiveDate);
  if (existingOnDate) {
    await createDatabaseBackup(raw, paths, "pre-correction");
  }
  return db.transaction((transaction) => {
    const item = loadActiveManualItem(transaction, input.manualItemId);
    assertLifecycleChangeOpenInDatabase(
      transaction,
      effectiveDate,
      "carrying a manual valuation forward",
    );
    const valuations = transaction
      .select()
      .from(manualItemValuations)
      .where(eq(manualItemValuations.manualItemId, item.id))
      .all();
    const source = currentValuations(valuations).find(
      (valuation) => valuation.id === input.sourceValuationId,
    );
    if (!source) {
      throw new DomainError("Choose the current valuation to carry forward.");
    }
    if (effectiveDate <= source.effectiveDate) {
      throw new DomainError("The carry-forward date must be after its source value.");
    }
    const sameDateCurrent = currentValuations(valuations).find(
      (valuation) => valuation.effectiveDate === effectiveDate,
    );
    const result = transaction
      .insert(manualItemValuations)
      .values({
        manualItemId: item.id,
        effectiveDate,
        valueMinor: source.valueMinor,
        sourceNote: acknowledgment,
        origin: "manual",
        carriedForwardFromValuationId: source.id,
        supersedesValuationId: sameDateCurrent?.id ?? null,
      })
      .run();
    const valuationId = Number(result.lastInsertRowid);
    recordAuditEvent(transaction, {
      action: "manual_item.valuation_recorded",
      entityType: "manual_item_valuation",
      entityId: valuationId,
      details: {
        manualItemId: item.id,
        effectiveDate,
        valueMinor: source.valueMinor,
        origin: "manual",
        carriedForwardFromValuationId: source.id,
        supersedesValuationId: sameDateCurrent?.id ?? null,
      },
    });
    return valuationId;
  });
}

export async function archiveManualItem(
  manualItemId: number,
  archivedOnInput?: string,
): Promise<void> {
  const { db } = await getDatabaseContext();
  const today = getLocalCalendarDate();
  const archivedOn = calendarDateSchema.parse(archivedOnInput ?? today);
  if (archivedOn > today) {
    throw new DomainError("The manual item closing date cannot be in the future.");
  }
  db.transaction((transaction) => {
    const item = loadActiveManualItem(transaction, manualItemId);
    assertLifecycleChangeOpenInDatabase(
      transaction,
      archivedOn,
      "archiving this manual item",
    );
    if (archivedOn < item.openingDate) {
      throw new DomainError("The closing date cannot be before tracking began.");
    }
    const latest = currentValuations(
      transaction
        .select()
        .from(manualItemValuations)
        .where(eq(manualItemValuations.manualItemId, item.id))
        .all(),
    ).sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0];
    if (latest && archivedOn < latest.effectiveDate) {
      throw new DomainError(
        `The closing date cannot be before the latest valuation (${latest.effectiveDate}).`,
      );
    }
    transaction
      .update(manualItems)
      .set({
        archivedAt: sql`CURRENT_TIMESTAMP`,
        archivedOn,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(manualItems.id, item.id))
      .run();
    recordAuditEvent(transaction, {
      action: "manual_item.archived",
      entityType: "manual_item",
      entityId: item.id,
      details: { archivedOn },
    });
  });
}

export async function restoreManualItem(manualItemId: number): Promise<void> {
  const { db } = await getDatabaseContext();
  db.transaction((transaction) => {
    const item = transaction
      .select()
      .from(manualItems)
      .where(eq(manualItems.id, manualItemId))
      .get();
    if (!item) {
      throw new DomainError("The manual item does not exist.");
    }
    if (!item.archivedAt) {
      return;
    }
    if (!item.archivedOn) {
      throw new Error("The archived manual item is missing its final active date.");
    }
    assertLifecycleChangeOpenInDatabase(
      transaction,
      item.archivedOn,
      "restoring this manual item",
    );
    transaction
      .update(manualItems)
      .set({ archivedAt: null, archivedOn: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(manualItems.id, item.id))
      .run();
    recordAuditEvent(transaction, {
      action: "manual_item.restored",
      entityType: "manual_item",
      entityId: item.id,
      details: { priorArchivedOn: item.archivedOn },
    });
  });
}

export async function setOutsideScopeTransferManualItem(input: {
  transferResolutionId: number;
  manualItemId: number | null;
}): Promise<void> {
  const { db } = await getDatabaseContext();
  db.transaction((transaction) => {
    const resolution = transaction
      .select({
        id: importTransferResolutions.id,
        importRowId: importTransferResolutions.importRowId,
        classification: importTransferResolutions.classification,
        reclassificationJournalEntryId:
          importTransferResolutions.reclassificationJournalEntryId,
        manualItemId: importTransferResolutions.manualItemId,
      })
      .from(importTransferResolutions)
      .where(eq(importTransferResolutions.id, input.transferResolutionId))
      .get();
    if (
      !resolution ||
      (resolution.classification !== "external_out" &&
        resolution.classification !== "external_in") ||
      !resolution.reclassificationJournalEntryId
    ) {
      throw new DomainError("Choose a posted outside-scope transfer.");
    }
    const effectiveDate = transaction
      .select({ effectiveDate: journalEntries.effectiveDate })
      .from(journalEntries)
      .where(eq(journalEntries.id, resolution.reclassificationJournalEntryId))
      .get()?.effectiveDate;
    if (!effectiveDate) {
      throw new Error("The outside-scope transfer is missing its effective date.");
    }
    assertLifecycleChangeOpenInDatabase(
      transaction,
      effectiveDate,
      "changing its manual-valuation link",
    );
    if (input.manualItemId !== null) {
      loadActiveManualItem(transaction, input.manualItemId);
    }
    transaction
      .update(importTransferResolutions)
      .set({ manualItemId: input.manualItemId, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(importTransferResolutions.id, resolution.id))
      .run();
    recordAuditEvent(transaction, {
      action: "transfer.manual_item_link_changed",
      entityType: "import_row",
      entityId: resolution.importRowId,
      details: {
        priorManualItemId: resolution.manualItemId,
        manualItemId: input.manualItemId,
        reclassificationJournalEntryId: resolution.reclassificationJournalEntryId,
      },
    });
  });
}

export async function listOutsideScopeTransferAssignments(): Promise<
  OutsideScopeTransferAssignment[]
> {
  const { db } = await getDatabaseContext();
  const rows = db
    .select({
      resolutionId: importTransferResolutions.id,
      importRowId: importRows.id,
      description: importRows.description,
      effectiveDate: journalEntries.effectiveDate,
      amountMinor: importRows.amountMinor,
      currency: importRows.currency,
      accountName: financialAccounts.name,
      manualItemId: importTransferResolutions.manualItemId,
      manualItemName: manualItems.name,
    })
    .from(importTransferResolutions)
    .innerJoin(importRows, eq(importRows.id, importTransferResolutions.importRowId))
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .innerJoin(
      journalEntries,
      eq(journalEntries.id, importTransferResolutions.reclassificationJournalEntryId),
    )
    .leftJoin(manualItems, eq(manualItems.id, importTransferResolutions.manualItemId))
    .where(
      inArray(importTransferResolutions.classification, [
        "external_out",
        "external_in",
      ]),
    )
    .orderBy(journalEntries.effectiveDate, importRows.id)
    .all();
  return rows.map((row) => ({
    ...row,
    currency: baseCurrencySchema.parse(row.currency),
  }));
}
