import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import { queryInChunks } from "@/db/query-chunks";
import {
  categories,
  financialAccounts,
  importBatches,
  importDuplicateCandidates,
  importRowCategoryAllocations,
  importRowDecisions,
  importRows,
} from "@/db/schema";
import type { AppDatabase, AppTransaction } from "@/db/types";
import {
  financialAccountTypeSchema,
  type FinancialAccountType,
} from "@/domain/accounts";
import { isCalendarDate } from "@/domain/calendar-date";
import { baseCurrencySchema, type BaseCurrency } from "@/domain/currencies";
import { DomainError } from "@/domain/errors";
import {
  compareDuplicateCandidates,
  confirmedTypeSchema,
  deriveDefaultEffectiveDate,
  deriveInboxFilters,
  dispositionSchema,
  getReviewBlockers,
  getRowReviewBlockers,
  inboxFilterSchema,
  type CategoryAllocation,
  type CategoryKind,
  type ConfirmedType,
  type Disposition,
  type InboxFilter,
  type InboxWarning,
  type ReviewBlocker,
  type ReviewDecision,
} from "@/domain/review";
import { recordAuditEvent } from "@/features/audit/audit-service";
import {
  deriveTransferCandidates,
  getTransferCandidateWindow,
  type TransferCandidateHint,
  type TransferCandidateSource,
} from "@/features/reconciliation/transfer-candidates";
import {
  currentDuplicateScanVersion,
  refreshDuplicateCandidatesForBatch,
} from "@/features/reconciliation/duplicate-detection-service";
import { clearTransferResolutionsInDatabase } from "@/features/transfers/transfer-service";

type ReviewDatabase = AppDatabase | AppTransaction;

export type ReviewCategory = {
  id: number;
  name: string;
  kind: CategoryKind;
  archivedAt: string | null;
};

export type ReviewAllocation = CategoryAllocation & {
  id: number;
  decisionId: number;
  category: ReviewCategory;
};

export type ReviewWarning = InboxWarning & {
  severity?: string;
  message?: string;
  rowNumber?: number;
};

export type ReviewDecisionView = Omit<ReviewDecision, "allocations"> & {
  id: number | null;
  effectiveDate: string | null;
  normalizedMerchant: string | null;
  reviewNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  allocations: ReviewAllocation[];
};

export type DuplicateCandidateView = {
  id: number;
  importRowId: number;
  candidateImportRowId: number;
  matchKind: "external_id" | "signature" | "statement_overlap";
  strength: "strong" | "weak";
  status: "open" | "dismissed" | "confirmed";
  createdAt: string;
  updatedAt: string;
  candidate: {
    id: number;
    importBatchId: number;
    originalRowNumber: number;
    transactionDate: string;
    description: string;
    amountMinor: number;
    currency: BaseCurrency;
    accountId: number;
    accountName: string;
    statementStartDate: string;
    statementEndDate: string;
  };
};

export type ReviewRowView = {
  id: number;
  importBatchId: number;
  originalRowNumber: number;
  transactionDate: string;
  postedDate: string | null;
  description: string;
  amountMinor: number;
  currency: BaseCurrency;
  externalId: string | null;
  merchant: string | null;
  suggestedType: ConfirmedType | null;
  suggestedCategory: string | null;
  suggestedCategoryId: number | null;
  notes: string | null;
  defaultEffectiveDate: string;
  normalizedFingerprint: string;
  validationStatus: string;
  warnings: ReviewWarning[];
  batch: {
    id: number;
    sourceFilename: string;
    statementStartDate: string;
    statementEndDate: string;
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    reviewStatus: "pending" | "in_review" | "finalized";
    finalizedAt: string | null;
    importedAt: string;
  };
  account: {
    id: number;
    name: string;
    type: FinancialAccountType;
    currency: BaseCurrency;
    openingDate: string;
  };
  decision: ReviewDecisionView;
  duplicateCandidates: DuplicateCandidateView[];
  openDuplicateCandidates: DuplicateCandidateView[];
  transferCandidates: TransferCandidateHint[];
  blockers: ReviewBlocker[];
  inboxFilters: InboxFilter[];
};

export type ReviewInboxQuery = {
  batchId?: number;
  filter?: InboxFilter;
  page?: number;
  pageSize?: number;
  limit?: number;
  offset?: number;
};

export type ReviewInboxPage = {
  items: ReviewRowView[];
  rows: ReviewRowView[];
  availableCategories: ReviewCategory[];
  totalItems: number;
  total: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
};

export type SaveRowDecisionInput = {
  importRowId: number;
  disposition: Disposition;
  confirmedType?: ConfirmedType | null;
  effectiveDate?: string | null;
  normalizedMerchant?: string | null;
  reviewNote?: string | null;
  exclusionReason?: string | null;
  duplicateOfImportRowId?: number | null;
  allocations?: readonly {
    categoryId: number;
    amountMinor: number;
  }[];
};

export type SaveRowDecisionResult = {
  importRowId: number;
  batchId: number;
  disposition: Disposition;
};

function parseCategoryKind(value: string): CategoryKind {
  if (value !== "income" && value !== "expense") {
    throw new Error(`Unknown category kind: ${value}`);
  }
  return value;
}

function parseBatchReviewStatus(value: string): "pending" | "in_review" | "finalized" {
  if (value === "pending" || value === "in_review" || value === "finalized") {
    return value;
  }
  throw new Error(`Unknown import review status: ${value}`);
}

function parseCandidateMatchKind(value: string): DuplicateCandidateView["matchKind"] {
  if (
    value === "external_id" ||
    value === "signature" ||
    value === "statement_overlap"
  ) {
    return value;
  }
  throw new Error(`Unknown duplicate match kind: ${value}`);
}

function parseCandidateStrength(value: string): DuplicateCandidateView["strength"] {
  if (value === "strong" || value === "weak") {
    return value;
  }
  throw new Error(`Unknown duplicate strength: ${value}`);
}

function parseCandidateStatus(value: string): DuplicateCandidateView["status"] {
  if (value === "open" || value === "dismissed" || value === "confirmed") {
    return value;
  }
  throw new Error(`Unknown duplicate candidate status: ${value}`);
}

function parseWarnings(value: string): ReviewWarning[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Import row warnings are not an array.");
  }
  return parsed as ReviewWarning[];
}

function normalizedOptionalString(
  value: string | null | undefined,
  maximumLength: number,
  fieldLabel: string,
): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  if (normalized.length > maximumLength) {
    throw new DomainError(`${fieldLabel} must be ${maximumLength} characters or less.`);
  }
  return normalized;
}

function getWhereCondition(options: {
  batchId?: number;
  importRowIds?: readonly number[];
  nonFinalizedOnly?: boolean;
}): SQL | undefined {
  const conditions: SQL[] = [];
  if (options.batchId !== undefined) {
    conditions.push(eq(importRows.importBatchId, options.batchId));
  }
  if (options.importRowIds !== undefined) {
    if (options.importRowIds.length === 0) {
      return sql`0 = 1`;
    }
    conditions.push(inArray(importRows.id, [...options.importRowIds]));
  }
  if (options.nonFinalizedOnly) {
    conditions.push(sql`${importBatches.reviewStatus} != 'finalized'`);
  }
  return conditions.length === 0 ? undefined : and(...conditions);
}

async function listActiveCategories(
  database: ReviewDatabase,
): Promise<ReviewCategory[]> {
  return database
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      archivedAt: categories.archivedAt,
    })
    .from(categories)
    .where(isNull(categories.archivedAt))
    .orderBy(categories.kind, categories.name)
    .all()
    .map((category) => ({
      ...category,
      kind: parseCategoryKind(category.kind),
    }));
}

export function loadReviewRowsInDatabase(
  database: ReviewDatabase,
  options: {
    batchId?: number;
    importRowIds?: readonly number[];
    nonFinalizedOnly?: boolean;
  } = {},
): ReviewRowView[] {
  const baseRows = database
    .select({
      id: importRows.id,
      importBatchId: importRows.importBatchId,
      originalRowNumber: importRows.originalRowNumber,
      transactionDate: importRows.transactionDate,
      postedDate: importRows.postedDate,
      description: importRows.description,
      amountMinor: importRows.amountMinor,
      currency: importRows.currency,
      externalId: importRows.externalId,
      merchant: importRows.merchant,
      suggestedType: importRows.suggestedType,
      suggestedCategory: importRows.suggestedCategory,
      suggestedCategoryId: importRows.suggestedCategoryId,
      notes: importRows.notes,
      defaultEffectiveDate: importRows.defaultEffectiveDate,
      normalizedFingerprint: importRows.normalizedFingerprint,
      validationStatus: importRows.validationStatus,
      warningsJson: importRows.warningsJson,
      batchSourceFilename: importBatches.sourceFilename,
      batchStatementStartDate: importBatches.statementStartDate,
      batchStatementEndDate: importBatches.statementEndDate,
      batchOpeningBalanceMinor: importBatches.openingBalanceMinor,
      batchClosingBalanceMinor: importBatches.closingBalanceMinor,
      batchReviewStatus: importBatches.reviewStatus,
      batchFinalizedAt: importBatches.finalizedAt,
      batchImportedAt: importBatches.importedAt,
      accountId: financialAccounts.id,
      accountName: financialAccounts.name,
      accountType: financialAccounts.type,
      accountCurrency: financialAccounts.currency,
      accountOpeningDate: financialAccounts.openingDate,
      decisionId: importRowDecisions.id,
      disposition: importRowDecisions.disposition,
      confirmedType: importRowDecisions.confirmedType,
      effectiveDate: importRowDecisions.effectiveDate,
      normalizedMerchant: importRowDecisions.normalizedMerchant,
      reviewNote: importRowDecisions.reviewNote,
      exclusionReason: importRowDecisions.exclusionReason,
      duplicateOfImportRowId: importRowDecisions.duplicateOfImportRowId,
      decisionCreatedAt: importRowDecisions.createdAt,
      decisionUpdatedAt: importRowDecisions.updatedAt,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .leftJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
    .where(getWhereCondition(options))
    .orderBy(
      desc(importBatches.statementEndDate),
      desc(importBatches.id),
      asc(importRows.originalRowNumber),
    )
    .all();

  if (baseRows.length === 0) {
    return [];
  }

  const rowIds = baseRows.map((row) => row.id);
  const allocationRows = queryInChunks(rowIds, (chunk) =>
    database
      .select({
        id: importRowCategoryAllocations.id,
        importRowDecisionId: importRowCategoryAllocations.importRowDecisionId,
        importRowId: importRowCategoryAllocations.importRowId,
        categoryId: categories.id,
        amountMinor: importRowCategoryAllocations.amountMinor,
        categoryName: categories.name,
        categoryKind: categories.kind,
        categoryArchivedAt: categories.archivedAt,
      })
      .from(importRowCategoryAllocations)
      .innerJoin(categories, eq(categories.id, importRowCategoryAllocations.categoryId))
      .where(inArray(importRowCategoryAllocations.importRowId, chunk))
      .orderBy(importRowCategoryAllocations.id)
      .all(),
  );
  const allocationsByRow = new Map<number, ReviewAllocation[]>();
  for (const allocation of allocationRows) {
    const value: ReviewAllocation = {
      id: allocation.id,
      decisionId: allocation.importRowDecisionId,
      categoryId: allocation.categoryId,
      categoryKind: parseCategoryKind(allocation.categoryKind),
      amountMinor: allocation.amountMinor,
      category: {
        id: allocation.categoryId,
        name: allocation.categoryName,
        kind: parseCategoryKind(allocation.categoryKind),
        archivedAt: allocation.categoryArchivedAt,
      },
    };
    const list = allocationsByRow.get(allocation.importRowId);
    if (list) {
      list.push(value);
    } else {
      allocationsByRow.set(allocation.importRowId, [value]);
    }
  }

  const candidateRows = queryInChunks(rowIds, (chunk) =>
    database
      .select()
      .from(importDuplicateCandidates)
      .where(inArray(importDuplicateCandidates.importRowId, chunk))
      .all(),
  );
  const candidateSourceIds = [
    ...new Set(candidateRows.map((candidate) => candidate.candidateImportRowId)),
  ];
  const candidateSources = queryInChunks(candidateSourceIds, (chunk) =>
    database
      .select({
        id: importRows.id,
        importBatchId: importRows.importBatchId,
        originalRowNumber: importRows.originalRowNumber,
        transactionDate: importRows.transactionDate,
        description: importRows.description,
        amountMinor: importRows.amountMinor,
        currency: importRows.currency,
        accountId: financialAccounts.id,
        accountName: financialAccounts.name,
        statementStartDate: importBatches.statementStartDate,
        statementEndDate: importBatches.statementEndDate,
      })
      .from(importRows)
      .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
      .innerJoin(
        financialAccounts,
        eq(financialAccounts.id, importBatches.financialAccountId),
      )
      .where(inArray(importRows.id, chunk))
      .all(),
  );
  const candidateSourceById = new Map(
    candidateSources.map((candidate) => [candidate.id, candidate]),
  );
  const candidatesByRow = new Map<number, DuplicateCandidateView[]>();
  for (const candidate of candidateRows) {
    const source = candidateSourceById.get(candidate.candidateImportRowId);
    if (!source) {
      throw new Error("A duplicate candidate source row is missing.");
    }
    const value: DuplicateCandidateView = {
      id: candidate.id,
      importRowId: candidate.importRowId,
      candidateImportRowId: candidate.candidateImportRowId,
      matchKind: parseCandidateMatchKind(candidate.matchKind),
      strength: parseCandidateStrength(candidate.strength),
      status: parseCandidateStatus(candidate.status),
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      candidate: {
        ...source,
        currency: baseCurrencySchema.parse(source.currency),
      },
    };
    const list = candidatesByRow.get(candidate.importRowId);
    if (list) {
      list.push(value);
    } else {
      candidatesByRow.set(candidate.importRowId, [value]);
    }
  }
  for (const candidates of candidatesByRow.values()) {
    candidates.sort(compareDuplicateCandidates);
  }

  const canonicalIds = [
    ...new Set(
      baseRows.flatMap((row) =>
        row.duplicateOfImportRowId === null ? [] : [row.duplicateOfImportRowId],
      ),
    ),
  ];
  const canonicalDecisionRows = queryInChunks(canonicalIds, (chunk) =>
    database
      .select({
        rowId: importRows.id,
        disposition: importRowDecisions.disposition,
      })
      .from(importRows)
      .leftJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
      .where(inArray(importRows.id, chunk))
      .all(),
  );
  const canonicalDecisionById = new Map(
    canonicalDecisionRows.map((row) => [
      row.rowId,
      row.disposition === null ? null : dispositionSchema.parse(row.disposition),
    ]),
  );

  const transferWindow = getTransferCandidateWindow(
    baseRows.map((row) => row.transactionDate),
  );
  const targetCurrencies = [...new Set(baseRows.map((row) => row.currency))];
  const transferSourceRows: TransferCandidateSource[] = database
    .select({
      id: importRows.id,
      accountId: importBatches.financialAccountId,
      accountName: financialAccounts.name,
      currency: importRows.currency,
      amountMinor: importRows.amountMinor,
      transactionDate: importRows.transactionDate,
      description: importRows.description,
      suggestedType: importRows.suggestedType,
      confirmedType: importRowDecisions.confirmedType,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .innerJoin(
      financialAccounts,
      eq(financialAccounts.id, importBatches.financialAccountId),
    )
    .leftJoin(importRowDecisions, eq(importRowDecisions.importRowId, importRows.id))
    .where(
      and(
        gte(importRows.transactionDate, transferWindow.startDate),
        lte(importRows.transactionDate, transferWindow.endDate),
        inArray(importRows.currency, targetCurrencies),
      ),
    )
    .all()
    .map((row) => ({
      ...row,
      currency: baseCurrencySchema.parse(row.currency),
      suggestedType:
        row.suggestedType === null
          ? null
          : confirmedTypeSchema.parse(row.suggestedType),
      confirmedType:
        row.confirmedType === null
          ? null
          : confirmedTypeSchema.parse(row.confirmedType),
    }));
  const transferCandidates = deriveTransferCandidates(
    transferSourceRows,
    new Set(rowIds),
  );
  return baseRows.map((row) => {
    const disposition =
      row.disposition === null ? null : dispositionSchema.parse(row.disposition);
    const confirmedType =
      row.confirmedType === null ? null : confirmedTypeSchema.parse(row.confirmedType);
    const allocations = allocationsByRow.get(row.id) ?? [];
    const decision: ReviewDecisionView = {
      id: row.decisionId,
      disposition,
      confirmedType,
      effectiveDate: row.effectiveDate,
      normalizedMerchant: row.normalizedMerchant,
      note: row.reviewNote,
      reviewNote: row.reviewNote,
      exclusionReason: row.exclusionReason,
      duplicateOfRowId: row.duplicateOfImportRowId,
      effectiveDateConfirmed: disposition === "accepted" && row.effectiveDate !== null,
      allocations,
      createdAt: row.decisionCreatedAt,
      updatedAt: row.decisionUpdatedAt,
    };
    const canonical =
      row.duplicateOfImportRowId === null
        ? null
        : {
            rowId: row.duplicateOfImportRowId,
            disposition: canonicalDecisionById.get(row.duplicateOfImportRowId) ?? null,
          };
    const blockers = getRowReviewBlockers({
      sourceAmountMinor: row.amountMinor,
      decision,
      effectiveDate: row.effectiveDate,
      accountOpeningDate: row.accountOpeningDate,
      categories: allocations.map((allocation) => ({
        id: allocation.category.id,
        name: allocation.category.name,
        archivedAt: allocation.category.archivedAt,
      })),
      canonicalDuplicate: canonical,
      batchFinalized: row.batchReviewStatus === "finalized",
    });
    const duplicateCandidates = candidatesByRow.get(row.id) ?? [];
    const openDuplicateCandidates = duplicateCandidates.filter(
      (candidate) => candidate.status === "open",
    );
    const rowTransferCandidates = transferCandidates.get(row.id) ?? [];
    const warnings = parseWarnings(row.warningsJson);
    const inboxFilters = deriveInboxFilters({
      warnings,
      duplicateCandidates: openDuplicateCandidates,
      transferCandidates: rowTransferCandidates,
      possibleTransfer:
        row.suggestedType === "transfer" || rowTransferCandidates.length > 0,
      suggestedType:
        row.suggestedType === null
          ? null
          : confirmedTypeSchema.parse(row.suggestedType),
      decision,
      blockers,
    });

    return {
      id: row.id,
      importBatchId: row.importBatchId,
      originalRowNumber: row.originalRowNumber,
      transactionDate: row.transactionDate,
      postedDate: row.postedDate,
      description: row.description,
      amountMinor: row.amountMinor,
      currency: baseCurrencySchema.parse(row.currency),
      externalId: row.externalId,
      merchant: row.merchant,
      suggestedType:
        row.suggestedType === null
          ? null
          : confirmedTypeSchema.parse(row.suggestedType),
      suggestedCategory: row.suggestedCategory,
      suggestedCategoryId: row.suggestedCategoryId,
      notes: row.notes,
      defaultEffectiveDate: row.defaultEffectiveDate,
      normalizedFingerprint: row.normalizedFingerprint,
      validationStatus: row.validationStatus,
      warnings,
      batch: {
        id: row.importBatchId,
        sourceFilename: row.batchSourceFilename,
        statementStartDate: row.batchStatementStartDate,
        statementEndDate: row.batchStatementEndDate,
        openingBalanceMinor: row.batchOpeningBalanceMinor,
        closingBalanceMinor: row.batchClosingBalanceMinor,
        reviewStatus: parseBatchReviewStatus(row.batchReviewStatus),
        finalizedAt: row.batchFinalizedAt,
        importedAt: row.batchImportedAt,
      },
      account: {
        id: row.accountId,
        name: row.accountName,
        type: financialAccountTypeSchema.parse(row.accountType),
        currency: baseCurrencySchema.parse(row.accountCurrency),
        openingDate: row.accountOpeningDate,
      },
      decision,
      duplicateCandidates,
      openDuplicateCandidates,
      transferCandidates: rowTransferCandidates,
      blockers,
      inboxFilters,
    };
  });
}

export async function listReviewInbox(
  query: ReviewInboxQuery = {},
): Promise<ReviewInboxPage> {
  const { db } = await getDatabaseContext();
  if (query.filter && !inboxFilterSchema.safeParse(query.filter).success) {
    throw new DomainError("Choose a valid review filter.");
  }
  const allRows = await loadReviewRowsInDatabase(db, {
    batchId: query.batchId,
    nonFinalizedOnly: query.batchId === undefined,
  });
  const filteredRows = query.filter
    ? allRows.filter((row) => row.inboxFilters.includes(query.filter!))
    : allRows;
  const requestedPageSize = query.limit ?? query.pageSize ?? 50;
  const pageSize =
    Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 100)
      : 50;
  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const offset =
    query.offset !== undefined &&
    Number.isSafeInteger(query.offset) &&
    query.offset >= 0
      ? query.offset
      : undefined;
  const requestedPage =
    offset === undefined ? (query.page ?? 1) : Math.floor(offset / pageSize) + 1;
  const currentPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, totalPages)
      : 1;
  const pageOffset = offset ?? (currentPage - 1) * pageSize;
  const items = filteredRows.slice(pageOffset, pageOffset + pageSize);

  return {
    items,
    rows: items,
    availableCategories: await listActiveCategories(db),
    totalItems,
    total: totalItems,
    currentPage,
    totalPages,
    pageSize,
  };
}

export function listBatchReviewInbox(
  batchId: number,
  query: Omit<ReviewInboxQuery, "batchId"> = {},
): Promise<ReviewInboxPage> {
  return listReviewInbox({ ...query, batchId });
}

export async function getReviewRow(
  importRowId: number,
): Promise<(ReviewRowView & { availableCategories: ReviewCategory[] }) | null> {
  const { db } = await getDatabaseContext();
  const rows = await loadReviewRowsInDatabase(db, { importRowIds: [importRowId] });
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    ...row,
    availableCategories: await listActiveCategories(db),
  };
}

export const getReviewRowDetails = getReviewRow;

export async function listReviewRowsForBatch(
  importBatchId: number,
): Promise<ReviewRowView[]> {
  const { db } = await getDatabaseContext();
  return loadReviewRowsInDatabase(db, { batchId: importBatchId });
}

export async function getReviewRowContext(importRowId: number): Promise<{
  importRowId: number;
  batchId: number;
  currency: BaseCurrency;
} | null> {
  const { db } = await getDatabaseContext();
  const row = db
    .select({
      importRowId: importRows.id,
      batchId: importRows.importBatchId,
      currency: importBatches.currency,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .where(eq(importRows.id, importRowId))
    .get();
  return row ? { ...row, currency: baseCurrencySchema.parse(row.currency) } : null;
}

function decisionSummary(
  decision:
    | {
        disposition: string;
        confirmedType: string | null;
        effectiveDate: string | null;
        normalizedMerchant: string | null;
        reviewNote: string | null;
        exclusionReason: string | null;
        duplicateOfImportRowId: number | null;
      }
    | undefined,
  allocations: readonly { categoryId: number; amountMinor: number }[],
) {
  return decision
    ? {
        disposition: decision.disposition,
        confirmedType: decision.confirmedType,
        effectiveDate: decision.effectiveDate,
        normalizedMerchant: decision.normalizedMerchant,
        reviewNote: decision.reviewNote,
        exclusionReason: decision.exclusionReason,
        duplicateOfImportRowId: decision.duplicateOfImportRowId,
        allocations: allocations.map((allocation) => ({ ...allocation })),
      }
    : null;
}

export async function saveRowDecision(
  input: SaveRowDecisionInput,
): Promise<SaveRowDecisionResult> {
  const { db } = await getDatabaseContext();
  if (!Number.isSafeInteger(input.importRowId) || input.importRowId <= 0) {
    throw new DomainError("The import row identifier is invalid.");
  }
  const parsedDisposition = dispositionSchema.safeParse(input.disposition);
  if (!parsedDisposition.success) {
    throw new DomainError("Choose a valid review decision.");
  }

  return db.transaction(
    (transaction) => {
      const sourceRow = transaction
        .select({
          id: importRows.id,
          importBatchId: importRows.importBatchId,
          accountId: importBatches.financialAccountId,
          accountType: financialAccounts.type,
          accountOpeningDate: financialAccounts.openingDate,
          amountMinor: importRows.amountMinor,
          transactionDate: importRows.transactionDate,
          postedDate: importRows.postedDate,
          batchReviewStatus: importBatches.reviewStatus,
          duplicateScanVersion: importBatches.duplicateScanVersion,
        })
        .from(importRows)
        .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
        .innerJoin(
          financialAccounts,
          eq(financialAccounts.id, importBatches.financialAccountId),
        )
        .where(eq(importRows.id, input.importRowId))
        .get();

      if (!sourceRow) {
        throw new DomainError("The import row does not exist.");
      }
      if (sourceRow.batchReviewStatus === "finalized") {
        throw new DomainError("A finalized statement cannot be changed.");
      }
      if (sourceRow.duplicateScanVersion < currentDuplicateScanVersion) {
        refreshDuplicateCandidatesForBatch(transaction, sourceRow.importBatchId);
      }

      const disposition = parsedDisposition.data;
      if (disposition !== "accepted") {
        const finalizedDependent = transaction
          .select({ id: importRowDecisions.id })
          .from(importRowDecisions)
          .innerJoin(importRows, eq(importRows.id, importRowDecisions.importRowId))
          .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
          .where(
            and(
              eq(importRowDecisions.disposition, "duplicate"),
              eq(importRowDecisions.duplicateOfImportRowId, sourceRow.id),
              eq(importBatches.reviewStatus, "finalized"),
            ),
          )
          .get();
        if (finalizedDependent) {
          throw new DomainError(
            "This row is the canonical source for a finalized duplicate and must remain accepted.",
          );
        }
      }
      const normalizedMerchant = normalizedOptionalString(
        input.normalizedMerchant,
        140,
        "The normalized merchant",
      );
      const reviewNote = normalizedOptionalString(
        input.reviewNote,
        500,
        "The review note",
      );
      const exclusionReason =
        disposition === "excluded"
          ? normalizedOptionalString(input.exclusionReason, 500, "The exclusion reason")
          : null;
      const duplicateOfImportRowId =
        disposition === "duplicate" ? (input.duplicateOfImportRowId ?? null) : null;
      if (duplicateOfImportRowId === sourceRow.id) {
        throw new DomainError("A duplicate row cannot link to itself.");
      }
      const confirmedType =
        disposition === "accepted" ? (input.confirmedType ?? null) : null;
      if (
        confirmedType !== null &&
        !confirmedTypeSchema.safeParse(confirmedType).success
      ) {
        throw new DomainError("Choose a valid transaction type.");
      }
      const effectiveDate =
        disposition === "accepted"
          ? (normalizedOptionalString(input.effectiveDate, 10, "The effective date") ??
            deriveDefaultEffectiveDate({
              accountType: financialAccountTypeSchema.parse(sourceRow.accountType),
              transactionType: confirmedType,
              transactionDate: sourceRow.transactionDate,
              postedDate: sourceRow.postedDate,
              amountMinor: sourceRow.amountMinor,
            }))
          : null;
      if (effectiveDate !== null && !isCalendarDate(effectiveDate)) {
        throw new DomainError("Enter a valid effective date.");
      }
      if (effectiveDate !== null && effectiveDate < sourceRow.accountOpeningDate) {
        throw new DomainError(
          `The effective date cannot be before the account opening date (${sourceRow.accountOpeningDate}).`,
        );
      }

      const requestedAllocations =
        disposition === "accepted" ? [...(input.allocations ?? [])] : [];
      const categoryIds = [
        ...new Set(requestedAllocations.map((allocation) => allocation.categoryId)),
      ];
      const activeCategoryRows =
        categoryIds.length === 0
          ? []
          : transaction
              .select({
                id: categories.id,
                kind: categories.kind,
              })
              .from(categories)
              .where(
                and(inArray(categories.id, categoryIds), isNull(categories.archivedAt)),
              )
              .all();
      const activeCategoryById = new Map(
        activeCategoryRows.map((category) => [
          category.id,
          parseCategoryKind(category.kind),
        ]),
      );
      const allocations: CategoryAllocation[] = requestedAllocations.map(
        (allocation) => {
          const categoryKind = activeCategoryById.get(allocation.categoryId);
          if (!categoryKind) {
            throw new DomainError("Choose only active categories.");
          }
          return {
            categoryId: allocation.categoryId,
            categoryKind,
            amountMinor: allocation.amountMinor,
          };
        },
      );

      const canonical =
        duplicateOfImportRowId === null
          ? null
          : transaction
              .select({
                rowId: importRows.id,
                accountId: importBatches.financialAccountId,
                disposition: importRowDecisions.disposition,
              })
              .from(importRows)
              .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
              .leftJoin(
                importRowDecisions,
                eq(importRowDecisions.importRowId, importRows.id),
              )
              .where(eq(importRows.id, duplicateOfImportRowId))
              .get();
      if (canonical && canonical.accountId !== sourceRow.accountId) {
        throw new DomainError(
          "A duplicate must link to a canonical row from the same account.",
        );
      }
      if (duplicateOfImportRowId !== null) {
        const candidateEdge = transaction
          .select({ id: importDuplicateCandidates.id })
          .from(importDuplicateCandidates)
          .where(
            and(
              eq(importDuplicateCandidates.importRowId, sourceRow.id),
              eq(
                importDuplicateCandidates.candidateImportRowId,
                duplicateOfImportRowId,
              ),
              inArray(importDuplicateCandidates.status, ["open", "confirmed"]),
            ),
          )
          .get();
        if (!candidateEdge) {
          throw new DomainError(
            "Choose an open duplicate candidate owned by this row. The later import row must point to the earlier canonical row.",
          );
        }
      }
      const canonicalDuplicate =
        canonical === null || canonical === undefined
          ? null
          : {
              rowId: canonical.rowId,
              disposition:
                canonical.disposition === null
                  ? null
                  : dispositionSchema.parse(canonical.disposition),
            };
      const decision: ReviewDecision = {
        disposition,
        confirmedType,
        allocations,
        note: reviewNote,
        exclusionReason,
        duplicateOfRowId: duplicateOfImportRowId,
        effectiveDateConfirmed: disposition === "accepted",
      };
      const blockers = getReviewBlockers({
        sourceAmountMinor: sourceRow.amountMinor,
        decision,
        canonicalDuplicate,
      });
      if (blockers.length > 0) {
        throw new DomainError(blockers[0]!.message);
      }

      const oldDecision = transaction
        .select()
        .from(importRowDecisions)
        .where(eq(importRowDecisions.importRowId, sourceRow.id))
        .get();
      const oldAllocations = oldDecision
        ? transaction
            .select({
              categoryId: importRowCategoryAllocations.categoryId,
              amountMinor: importRowCategoryAllocations.amountMinor,
            })
            .from(importRowCategoryAllocations)
            .where(eq(importRowCategoryAllocations.importRowId, sourceRow.id))
            .orderBy(importRowCategoryAllocations.id)
            .all()
        : [];
      const clearedTransferResolutions =
        disposition === "accepted" && confirmedType === "transfer"
          ? []
          : clearTransferResolutionsInDatabase(transaction, [sourceRow.id]);

      transaction
        .delete(importRowCategoryAllocations)
        .where(eq(importRowCategoryAllocations.importRowId, sourceRow.id))
        .run();
      transaction
        .insert(importRowDecisions)
        .values({
          importRowId: sourceRow.id,
          disposition,
          confirmedType,
          effectiveDate,
          normalizedMerchant,
          reviewNote,
          exclusionReason,
          duplicateOfImportRowId,
        })
        .onConflictDoUpdate({
          target: importRowDecisions.importRowId,
          set: {
            disposition,
            confirmedType,
            effectiveDate,
            normalizedMerchant,
            reviewNote,
            exclusionReason,
            duplicateOfImportRowId,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .run();
      const savedDecision = transaction
        .select({ id: importRowDecisions.id })
        .from(importRowDecisions)
        .where(eq(importRowDecisions.importRowId, sourceRow.id))
        .get();
      if (!savedDecision) {
        throw new Error("The review decision could not be loaded after saving.");
      }
      if (allocations.length > 0) {
        transaction
          .insert(importRowCategoryAllocations)
          .values(
            allocations.map((allocation) => ({
              importRowDecisionId: savedDecision.id,
              importRowId: sourceRow.id,
              categoryId: allocation.categoryId,
              amountMinor: allocation.amountMinor,
            })),
          )
          .run();
      }

      if (
        oldDecision?.disposition === "duplicate" &&
        oldDecision.duplicateOfImportRowId !== null &&
        (disposition !== "duplicate" ||
          oldDecision.duplicateOfImportRowId !== duplicateOfImportRowId)
      ) {
        transaction
          .update(importDuplicateCandidates)
          .set({ status: "open", updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(
            and(
              eq(importDuplicateCandidates.importRowId, sourceRow.id),
              eq(
                importDuplicateCandidates.candidateImportRowId,
                oldDecision.duplicateOfImportRowId,
              ),
              eq(importDuplicateCandidates.status, "confirmed"),
            ),
          )
          .run();
      }

      if (disposition === "duplicate" && duplicateOfImportRowId !== null) {
        transaction
          .update(importDuplicateCandidates)
          .set({ status: "confirmed", updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(
            and(
              eq(importDuplicateCandidates.importRowId, sourceRow.id),
              eq(
                importDuplicateCandidates.candidateImportRowId,
                duplicateOfImportRowId,
              ),
            ),
          )
          .run();
      }

      transaction
        .update(importBatches)
        .set({ reviewStatus: "in_review" })
        .where(
          and(
            eq(importBatches.id, sourceRow.importBatchId),
            eq(importBatches.reviewStatus, "pending"),
          ),
        )
        .run();

      recordAuditEvent(transaction, {
        action: "review.row_decision_saved",
        entityType: "import_row",
        entityId: sourceRow.id,
        details: {
          batchId: sourceRow.importBatchId,
          old: decisionSummary(oldDecision, oldAllocations),
          new: decisionSummary(
            {
              disposition,
              confirmedType,
              effectiveDate,
              normalizedMerchant,
              reviewNote,
              exclusionReason,
              duplicateOfImportRowId,
            },
            allocations,
          ),
          clearedTransferResolutions,
        },
      });

      return {
        importRowId: sourceRow.id,
        batchId: sourceRow.importBatchId,
        disposition,
      };
    },
    { behavior: "immediate" },
  );
}

export async function dismissDuplicateCandidate(
  candidateId: number,
): Promise<{ candidateId: number; importRowId: number; batchId: number }> {
  const { db } = await getDatabaseContext();
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
    throw new DomainError("The duplicate candidate identifier is invalid.");
  }

  return db.transaction(
    (transaction) => {
      const candidate = transaction
        .select({
          id: importDuplicateCandidates.id,
          importRowId: importDuplicateCandidates.importRowId,
          candidateImportRowId: importDuplicateCandidates.candidateImportRowId,
          status: importDuplicateCandidates.status,
          matchKind: importDuplicateCandidates.matchKind,
          strength: importDuplicateCandidates.strength,
          batchId: importRows.importBatchId,
          batchReviewStatus: importBatches.reviewStatus,
        })
        .from(importDuplicateCandidates)
        .innerJoin(importRows, eq(importRows.id, importDuplicateCandidates.importRowId))
        .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
        .where(eq(importDuplicateCandidates.id, candidateId))
        .get();
      if (!candidate) {
        throw new DomainError("The duplicate candidate does not exist.");
      }
      if (candidate.batchReviewStatus === "finalized") {
        throw new DomainError("A finalized statement cannot be changed.");
      }
      if (candidate.status === "confirmed") {
        throw new DomainError(
          "A confirmed duplicate candidate cannot be dismissed until the row decision changes.",
        );
      }
      if (candidate.status === "dismissed") {
        return {
          candidateId: candidate.id,
          importRowId: candidate.importRowId,
          batchId: candidate.batchId,
        };
      }

      transaction
        .update(importDuplicateCandidates)
        .set({ status: "dismissed", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(importDuplicateCandidates.id, candidate.id))
        .run();
      transaction
        .update(importBatches)
        .set({ reviewStatus: "in_review" })
        .where(
          and(
            eq(importBatches.id, candidate.batchId),
            eq(importBatches.reviewStatus, "pending"),
          ),
        )
        .run();
      recordAuditEvent(transaction, {
        action: "review.duplicate_candidate_dismissed",
        entityType: "duplicate_candidate",
        entityId: candidate.id,
        details: {
          batchId: candidate.batchId,
          importRowId: candidate.importRowId,
          candidateImportRowId: candidate.candidateImportRowId,
          matchKind: candidate.matchKind,
          strength: candidate.strength,
          oldStatus: candidate.status,
          newStatus: "dismissed",
        },
      });

      return {
        candidateId: candidate.id,
        importRowId: candidate.importRowId,
        batchId: candidate.batchId,
      };
    },
    { behavior: "immediate" },
  );
}
