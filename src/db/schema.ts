import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appSettings = sqliteTable(
  "app_settings",
  {
    id: integer("id").primaryKey(),
    baseCurrency: text("base_currency").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("app_settings_singleton", sql`${table.id} = 1`),
    check("app_settings_currency_length", sql`length(${table.baseCurrency}) = 3`),
  ],
);

export const financialAccounts = sqliteTable(
  "financial_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    institution: text("institution"),
    type: text("type").notNull(),
    currency: text("currency").notNull(),
    openingDate: text("opening_date").notNull(),
    requiredForClose: integer("required_for_close", { mode: "boolean" })
      .notNull()
      .default(true),
    archivedAt: text("archived_at"),
    archivedOn: text("archived_on"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      "financial_accounts_type",
      sql`${table.type} IN ('checking', 'savings', 'cash', 'credit_card', 'loan', 'other_asset', 'other_liability')`,
    ),
    check("financial_accounts_currency_length", sql`length(${table.currency}) = 3`),
    check(
      "financial_accounts_opening_date",
      sql`${table.openingDate} GLOB '????-??-??'`,
    ),
    check(
      "financial_accounts_archived_on",
      sql`${table.archivedOn} IS NULL OR (
        ${table.archivedAt} IS NOT NULL
        AND ${table.archivedOn} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND strftime('%Y-%m-%d', ${table.archivedOn}, '+0 days') = ${table.archivedOn}
        AND ${table.archivedOn} >= ${table.openingDate}
      )`,
    ),
    index("financial_accounts_archived_at_index").on(table.archivedAt),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    archivedAt: text("archived_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("categories_slug_unique").on(table.slug),
    check("categories_kind", sql`${table.kind} IN ('income', 'expense')`),
    check("categories_name_not_blank", sql`length(trim(${table.name})) > 0`),
    index("categories_kind_archived_index").on(table.kind, table.archivedAt),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    financialAccountId: integer("financial_account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "restrict" }),
    sourceFilename: text("source_filename").notNull(),
    fileChecksum: text("file_checksum").notNull(),
    csvSchemaVersion: text("csv_schema_version").notNull(),
    currency: text("currency").notNull(),
    statementStartDate: text("statement_start_date").notNull(),
    statementEndDate: text("statement_end_date").notNull(),
    openingBalanceMinor: integer("opening_balance_minor").notNull(),
    closingBalanceMinor: integer("closing_balance_minor").notNull(),
    rowCount: integer("row_count").notNull(),
    warningCount: integer("warning_count").notNull(),
    validationStatus: text("validation_status").notNull(),
    reviewStatus: text("review_status").notNull(),
    isSealed: integer("is_sealed", { mode: "boolean" }).notNull().default(true),
    finalizedAt: text("finalized_at"),
    ledgerPostedAt: text("ledger_posted_at"),
    duplicateScanVersion: integer("duplicate_scan_version").notNull().default(0),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_batches_file_checksum_unique").on(table.fileChecksum),
    index("import_batches_account_statement_index").on(
      table.financialAccountId,
      table.statementEndDate,
    ),
    index("import_batches_account_coverage_index").on(
      table.financialAccountId,
      table.reviewStatus,
      table.statementStartDate,
      table.statementEndDate,
    ),
    check(
      "import_batches_source_filename_not_blank",
      sql`length(trim(${table.sourceFilename})) > 0`,
    ),
    check("import_batches_checksum_length", sql`length(${table.fileChecksum}) = 64`),
    check("import_batches_schema_version", sql`${table.csvSchemaVersion} = 'csv-v1'`),
    check("import_batches_currency_length", sql`length(${table.currency}) = 3`),
    check(
      "import_batches_statement_start_date",
      sql`${table.statementStartDate} GLOB '????-??-??'`,
    ),
    check(
      "import_batches_statement_end_date",
      sql`${table.statementEndDate} GLOB '????-??-??'`,
    ),
    check(
      "import_batches_statement_date_order",
      sql`${table.statementStartDate} <= ${table.statementEndDate}`,
    ),
    check("import_batches_row_count", sql`${table.rowCount} > 0`),
    check("import_batches_warning_count", sql`${table.warningCount} >= 0`),
    check(
      "import_batches_validation_status",
      sql`${table.validationStatus} = 'validated'`,
    ),
    check(
      "import_batches_review_status",
      sql`${table.reviewStatus} IN ('pending', 'in_review', 'finalized')`,
    ),
    check(
      "import_batches_ledger_posted_state",
      sql`${table.ledgerPostedAt} IS NULL OR ${table.reviewStatus} = 'finalized'`,
    ),
  ],
);

export const importRows = sqliteTable(
  "import_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importBatchId: integer("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "restrict" }),
    originalRowNumber: integer("original_row_number").notNull(),
    transactionDate: text("transaction_date").notNull(),
    postedDate: text("posted_date"),
    description: text("description").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    externalId: text("external_id"),
    merchant: text("merchant"),
    suggestedType: text("suggested_type"),
    suggestedCategory: text("suggested_category"),
    suggestedCategoryId: integer("suggested_category_id").references(
      () => categories.id,
      { onDelete: "restrict" },
    ),
    notes: text("notes"),
    defaultEffectiveDate: text("default_effective_date").notNull(),
    normalizedFingerprint: text("normalized_fingerprint").notNull(),
    validationStatus: text("validation_status").notNull(),
    reviewStatus: text("review_status").notNull(),
    warningsJson: text("warnings_json").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_rows_batch_row_unique").on(
      table.importBatchId,
      table.originalRowNumber,
    ),
    index("import_rows_external_id_index").on(table.externalId),
    index("import_rows_fingerprint_index").on(table.normalizedFingerprint),
    check("import_rows_original_row_number", sql`${table.originalRowNumber} >= 2`),
    check(
      "import_rows_transaction_date",
      sql`${table.transactionDate} GLOB '????-??-??'`,
    ),
    check(
      "import_rows_posted_date",
      sql`${table.postedDate} IS NULL OR ${table.postedDate} GLOB '????-??-??'`,
    ),
    check(
      "import_rows_default_effective_date",
      sql`${table.defaultEffectiveDate} GLOB '????-??-??'`,
    ),
    check(
      "import_rows_description_not_blank",
      sql`length(trim(${table.description})) > 0`,
    ),
    check("import_rows_currency_length", sql`length(${table.currency}) = 3`),
    check(
      "import_rows_suggested_type",
      sql`${table.suggestedType} IS NULL OR ${table.suggestedType} IN ('income', 'expense', 'transfer', 'refund', 'adjustment')`,
    ),
    check(
      "import_rows_fingerprint_length",
      sql`length(${table.normalizedFingerprint}) = 64`,
    ),
    check(
      "import_rows_validation_status",
      sql`${table.validationStatus} IN ('valid', 'valid_with_warnings')`,
    ),
    check("import_rows_review_status", sql`${table.reviewStatus} = 'unresolved'`),
  ],
);

export const importRowDecisions = sqliteTable(
  "import_row_decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importRowId: integer("import_row_id")
      .notNull()
      .references(() => importRows.id, { onDelete: "restrict" }),
    disposition: text("disposition").notNull(),
    confirmedType: text("confirmed_type"),
    effectiveDate: text("effective_date"),
    normalizedMerchant: text("normalized_merchant"),
    reviewNote: text("review_note"),
    exclusionReason: text("exclusion_reason"),
    duplicateOfImportRowId: integer("duplicate_of_import_row_id").references(
      () => importRows.id,
      { onDelete: "restrict" },
    ),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_row_decisions_import_row_unique").on(table.importRowId),
    uniqueIndex("import_row_decisions_id_row_unique").on(table.id, table.importRowId),
    index("import_row_decisions_disposition_index").on(table.disposition),
    index("import_row_decisions_duplicate_of_index").on(table.duplicateOfImportRowId),
    check(
      "import_row_decisions_disposition",
      sql`${table.disposition} IN ('accepted', 'excluded', 'duplicate')`,
    ),
    check(
      "import_row_decisions_confirmed_type",
      sql`${table.confirmedType} IS NULL OR ${table.confirmedType} IN ('income', 'expense', 'transfer', 'refund', 'adjustment')`,
    ),
    check(
      "import_row_decisions_effective_date",
      sql`${table.effectiveDate} IS NULL OR (
        ${table.effectiveDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND strftime('%Y-%m-%d', ${table.effectiveDate}, '+0 days') IS NOT NULL
        AND strftime('%Y-%m-%d', ${table.effectiveDate}, '+0 days') = ${table.effectiveDate}
      )`,
    ),
    check(
      "import_row_decisions_duplicate_not_self",
      sql`${table.duplicateOfImportRowId} IS NULL OR ${table.duplicateOfImportRowId} != ${table.importRowId}`,
    ),
    check(
      "import_row_decisions_disposition_details",
      sql`(
        ${table.disposition} = 'accepted'
        AND ${table.exclusionReason} IS NULL
        AND ${table.duplicateOfImportRowId} IS NULL
      ) OR (
        ${table.disposition} = 'excluded'
        AND ${table.exclusionReason} IS NOT NULL
        AND length(trim(${table.exclusionReason})) > 0
        AND ${table.duplicateOfImportRowId} IS NULL
      ) OR (
        ${table.disposition} = 'duplicate'
        AND ${table.exclusionReason} IS NULL
        AND ${table.duplicateOfImportRowId} IS NOT NULL
      )`,
    ),
  ],
);

export const importRowCategoryAllocations = sqliteTable(
  "import_row_category_allocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importRowDecisionId: integer("import_row_decision_id").notNull(),
    importRowId: integer("import_row_id")
      .notNull()
      .references(() => importRows.id, { onDelete: "restrict" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      name: "import_row_category_allocations_decision_row_fk",
      columns: [table.importRowDecisionId, table.importRowId],
      foreignColumns: [importRowDecisions.id, importRowDecisions.importRowId],
    }).onDelete("restrict"),
    uniqueIndex("import_row_category_allocations_row_category_unique").on(
      table.importRowId,
      table.categoryId,
    ),
    index("import_row_category_allocations_decision_index").on(
      table.importRowDecisionId,
    ),
    index("import_row_category_allocations_category_index").on(table.categoryId),
    check(
      "import_row_category_allocations_positive_amount",
      sql`${table.amountMinor} > 0`,
    ),
  ],
);

export const importDuplicateCandidates = sqliteTable(
  "import_duplicate_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importRowId: integer("import_row_id")
      .notNull()
      .references(() => importRows.id, { onDelete: "restrict" }),
    candidateImportRowId: integer("candidate_import_row_id")
      .notNull()
      .references(() => importRows.id, { onDelete: "restrict" }),
    matchKind: text("match_kind").notNull(),
    strength: text("strength").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_duplicate_candidates_pair_unique").on(
      table.importRowId,
      table.candidateImportRowId,
    ),
    index("import_duplicate_candidates_row_status_index").on(
      table.importRowId,
      table.status,
    ),
    index("import_duplicate_candidates_candidate_row_index").on(
      table.candidateImportRowId,
    ),
    check(
      "import_duplicate_candidates_match_kind",
      sql`${table.matchKind} IN ('external_id', 'signature', 'statement_overlap')`,
    ),
    check(
      "import_duplicate_candidates_strength",
      sql`${table.strength} IN ('strong', 'weak')`,
    ),
    check(
      "import_duplicate_candidates_status",
      sql`${table.status} IN ('open', 'dismissed', 'confirmed')`,
    ),
    check(
      "import_duplicate_candidates_not_self",
      sql`${table.importRowId} != ${table.candidateImportRowId}`,
    ),
  ],
);

export const importTransferResolutions = sqliteTable(
  "import_transfer_resolutions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importRowId: integer("import_row_id")
      .notNull()
      .references(() => importRows.id, { onDelete: "restrict" }),
    classification: text("classification").notNull(),
    counterpartImportRowId: integer("counterpart_import_row_id").references(
      () => importRows.id,
      { onDelete: "restrict" },
    ),
    reclassificationJournalEntryId: integer(
      "reclassification_journal_entry_id",
    ).references(() => journalEntries.id, { onDelete: "restrict" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_transfer_resolutions_row_unique").on(table.importRowId),
    uniqueIndex("import_transfer_resolutions_counterpart_unique").on(
      table.counterpartImportRowId,
    ),
    uniqueIndex("import_transfer_resolutions_reclassification_entry_unique").on(
      table.reclassificationJournalEntryId,
    ),
    index("import_transfer_resolutions_classification_index").on(table.classification),
    check(
      "import_transfer_resolutions_classification",
      sql`${table.classification} IN ('owned_account', 'card_payment', 'external_out', 'external_in', 'in_transit')`,
    ),
    check(
      "import_transfer_resolutions_details",
      sql`(
        ${table.classification} IN ('owned_account', 'card_payment')
        AND ${table.counterpartImportRowId} IS NOT NULL
        AND ${table.counterpartImportRowId} != ${table.importRowId}
      ) OR (
        ${table.classification} IN ('external_out', 'external_in', 'in_transit')
        AND ${table.counterpartImportRowId} IS NULL
      )`,
    ),
  ],
);

export const ledgerAccounts = sqliteTable(
  "ledger_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    systemKey: text("system_key"),
    financialAccountId: integer("financial_account_id").references(
      () => financialAccounts.id,
      { onDelete: "restrict" },
    ),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "restrict",
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("ledger_accounts_system_key_unique").on(table.systemKey),
    uniqueIndex("ledger_accounts_financial_account_unique").on(
      table.financialAccountId,
    ),
    uniqueIndex("ledger_accounts_category_unique").on(table.categoryId),
    check(
      "ledger_accounts_kind",
      sql`${table.kind} IN ('asset', 'liability', 'income', 'expense', 'equity', 'clearing')`,
    ),
    check(
      "ledger_accounts_single_identity",
      sql`((${table.systemKey} IS NOT NULL) + (${table.financialAccountId} IS NOT NULL) + (${table.categoryId} IS NOT NULL)) = 1`,
    ),
  ],
);

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    effectiveDate: text("effective_date").notNull(),
    description: text("description").notNull(),
    sourceType: text("source_type").notNull(),
    notes: text("notes"),
    reversesEntryId: integer("reverses_entry_id").references(
      (): AnySQLiteColumn => journalEntries.id,
      { onDelete: "restrict" },
    ),
    isPosted: integer("is_posted", { mode: "boolean" }).notNull().default(false),
    postedAt: text("posted_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("journal_entries_reverses_entry_unique").on(table.reversesEntryId),
    check(
      "journal_entries_effective_date",
      sql`${table.effectiveDate} GLOB '????-??-??'`,
    ),
    check(
      "journal_entries_source_type",
      sql`${table.sourceType} IN ('import', 'manual', 'opening_balance', 'system')`,
    ),
    check(
      "journal_entries_posted_state",
      sql`(${table.isPosted} = 0 AND ${table.postedAt} IS NULL) OR (${table.isPosted} = 1 AND ${table.postedAt} IS NOT NULL)`,
    ),
    check(
      "journal_entries_not_self_reversal",
      sql`${table.reversesEntryId} IS NULL OR ${table.reversesEntryId} != ${table.id}`,
    ),
    index("journal_entries_effective_date_index").on(table.effectiveDate),
  ],
);

export const importRowJournalEntries = sqliteTable(
  "import_row_journal_entries",
  {
    importRowId: integer("import_row_id")
      .primaryKey()
      .references(() => importRows.id, { onDelete: "restrict" }),
    journalEntryId: integer("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "restrict" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("import_row_journal_entries_entry_unique").on(table.journalEntryId),
  ],
);

export const postings = sqliteTable(
  "postings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    journalEntryId: integer("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "restrict" }),
    ledgerAccountId: integer("ledger_account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    memo: text("memo"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("postings_nonzero_amount", sql`${table.amountMinor} != 0`),
    index("postings_journal_entry_index").on(table.journalEntryId),
    index("postings_ledger_account_index").on(table.ledgerAccountId),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detailsJson: text("details_json").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_events_entity_index").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
