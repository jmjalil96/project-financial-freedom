CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`details_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_index` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "categories_kind" CHECK("categories"."kind" IN ('income', 'expense')),
	CONSTRAINT "categories_name_not_blank" CHECK(length(trim("categories"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_kind_archived_index` ON `categories` (`kind`,`archived_at`);--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`opening_date` text NOT NULL,
	`required_for_close` integer DEFAULT true NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "financial_accounts_type" CHECK("financial_accounts"."type" IN ('checking', 'savings', 'cash', 'credit_card', 'loan', 'other_asset', 'other_liability')),
	CONSTRAINT "financial_accounts_currency_length" CHECK(length("financial_accounts"."currency") = 3),
	CONSTRAINT "financial_accounts_opening_date" CHECK("financial_accounts"."opening_date" GLOB '????-??-??')
);
--> statement-breakpoint
CREATE INDEX `financial_accounts_archived_at_index` ON `financial_accounts` (`archived_at`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`effective_date` text NOT NULL,
	`description` text NOT NULL,
	`source_type` text NOT NULL,
	`notes` text,
	`reverses_entry_id` integer,
	`is_posted` integer DEFAULT false NOT NULL,
	`posted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reverses_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "journal_entries_effective_date" CHECK("journal_entries"."effective_date" GLOB '????-??-??'),
	CONSTRAINT "journal_entries_source_type" CHECK("journal_entries"."source_type" IN ('import', 'manual', 'opening_balance', 'system')),
	CONSTRAINT "journal_entries_posted_state" CHECK(("journal_entries"."is_posted" = 0 AND "journal_entries"."posted_at" IS NULL) OR ("journal_entries"."is_posted" = 1 AND "journal_entries"."posted_at" IS NOT NULL)),
	CONSTRAINT "journal_entries_not_self_reversal" CHECK("journal_entries"."reverses_entry_id" IS NULL OR "journal_entries"."reverses_entry_id" != "journal_entries"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_reverses_entry_unique` ON `journal_entries` (`reverses_entry_id`);--> statement-breakpoint
CREATE INDEX `journal_entries_effective_date_index` ON `journal_entries` (`effective_date`);--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`system_key` text,
	`financial_account_id` integer,
	`category_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`financial_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ledger_accounts_kind" CHECK("ledger_accounts"."kind" IN ('asset', 'liability', 'income', 'expense', 'equity', 'clearing')),
	CONSTRAINT "ledger_accounts_single_identity" CHECK((("ledger_accounts"."system_key" IS NOT NULL) + ("ledger_accounts"."financial_account_id" IS NOT NULL) + ("ledger_accounts"."category_id" IS NOT NULL)) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_system_key_unique` ON `ledger_accounts` (`system_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_financial_account_unique` ON `ledger_accounts` (`financial_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_category_unique` ON `ledger_accounts` (`category_id`);--> statement-breakpoint
CREATE TABLE `postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`journal_entry_id` integer NOT NULL,
	`ledger_account_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`memo` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "postings_nonzero_amount" CHECK("postings"."amount_minor" != 0)
);
--> statement-breakpoint
CREATE INDEX `postings_journal_entry_index` ON `postings` (`journal_entry_id`);--> statement-breakpoint
CREATE INDEX `postings_ledger_account_index` ON `postings` (`ledger_account_id`);