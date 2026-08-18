import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
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
