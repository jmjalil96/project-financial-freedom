CREATE TABLE `import_row_journal_entries` (
	`import_row_id` integer PRIMARY KEY NOT NULL,
	`journal_entry_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_journal_entries_entry_unique` ON `import_row_journal_entries` (`journal_entry_id`);--> statement-breakpoint
CREATE TABLE `import_transfer_resolutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_row_id` integer NOT NULL,
	`classification` text NOT NULL,
	`counterpart_import_row_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`counterpart_import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_transfer_resolutions_classification" CHECK("import_transfer_resolutions"."classification" IN ('owned_account', 'card_payment', 'external_out', 'external_in', 'in_transit')),
	CONSTRAINT "import_transfer_resolutions_details" CHECK((
        "import_transfer_resolutions"."classification" IN ('owned_account', 'card_payment')
        AND "import_transfer_resolutions"."counterpart_import_row_id" IS NOT NULL
        AND "import_transfer_resolutions"."counterpart_import_row_id" != "import_transfer_resolutions"."import_row_id"
      ) OR (
        "import_transfer_resolutions"."classification" IN ('external_out', 'external_in', 'in_transit')
        AND "import_transfer_resolutions"."counterpart_import_row_id" IS NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_transfer_resolutions_row_unique` ON `import_transfer_resolutions` (`import_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_transfer_resolutions_counterpart_unique` ON `import_transfer_resolutions` (`counterpart_import_row_id`);--> statement-breakpoint
CREATE INDEX `import_transfer_resolutions_classification_index` ON `import_transfer_resolutions` (`classification`);--> statement-breakpoint
ALTER TABLE `financial_accounts` ADD `archived_on` text;--> statement-breakpoint
UPDATE `financial_accounts`
SET `archived_on` = substr(`archived_at`, 1, 10)
WHERE `archived_at` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `ledger_posted_at` text;--> statement-breakpoint
CREATE INDEX `import_batches_account_coverage_index` ON `import_batches` (`financial_account_id`,`review_status`,`statement_start_date`,`statement_end_date`);--> statement-breakpoint
CREATE TRIGGER `financial_accounts_require_valid_archived_on_on_insert`
BEFORE INSERT ON `financial_accounts`
WHEN NEW.`archived_on` IS NOT NULL
	AND (
		NEW.`archived_at` IS NULL
		OR NEW.`archived_on` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') IS NULL
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') != NEW.`archived_on`
		OR NEW.`archived_on` < NEW.`opening_date`
	)
BEGIN
	SELECT RAISE(ABORT, 'account archival date is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `financial_accounts_require_valid_archived_on_on_update`
BEFORE UPDATE OF `archived_at`, `archived_on`, `opening_date` ON `financial_accounts`
WHEN NEW.`archived_on` IS NOT NULL
	AND (
		NEW.`archived_at` IS NULL
		OR NEW.`archived_on` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') IS NULL
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') != NEW.`archived_on`
		OR NEW.`archived_on` < NEW.`opening_date`
	)
BEGIN
	SELECT RAISE(ABORT, 'account archival date is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `import_batches_require_ledger_posted_state_on_insert`
BEFORE INSERT ON `import_batches`
WHEN NEW.`ledger_posted_at` IS NOT NULL AND NEW.`review_status` != 'finalized'
BEGIN
	SELECT RAISE(ABORT, 'only finalized import batches can be posted to the ledger');
END;--> statement-breakpoint
CREATE TRIGGER `import_batches_require_ledger_posted_state_on_update`
BEFORE UPDATE OF `review_status`, `ledger_posted_at` ON `import_batches`
WHEN NEW.`ledger_posted_at` IS NOT NULL AND NEW.`review_status` != 'finalized'
BEGIN
	SELECT RAISE(ABORT, 'only finalized import batches can be posted to the ledger');
END;--> statement-breakpoint
CREATE TRIGGER `import_batches_prevent_ledger_post_reversal`
BEFORE UPDATE OF `ledger_posted_at` ON `import_batches`
WHEN OLD.`ledger_posted_at` IS NOT NULL AND NEW.`ledger_posted_at` IS NOT OLD.`ledger_posted_at`
BEGIN
	SELECT RAISE(ABORT, 'posted import batches cannot be unposted or retimestamped');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_journal_entries_require_import_source`
BEFORE INSERT ON `import_row_journal_entries`
WHEN (
	SELECT `source_type` FROM `journal_entries` WHERE `id` = NEW.`journal_entry_id`
) != 'import'
OR NOT EXISTS (
	SELECT 1
	FROM `import_row_decisions`
	WHERE `import_row_id` = NEW.`import_row_id`
		AND `disposition` = 'accepted'
)
BEGIN
	SELECT RAISE(ABORT, 'import journal links require an accepted row and import entry');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_journal_entries_prevent_update`
BEFORE UPDATE ON `import_row_journal_entries`
BEGIN
	SELECT RAISE(ABORT, 'import journal links are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_journal_entries_prevent_delete`
BEFORE DELETE ON `import_row_journal_entries`
BEGIN
	SELECT RAISE(ABORT, 'import journal links are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `journal_entries_require_import_source_link`
BEFORE UPDATE OF `is_posted` ON `journal_entries`
WHEN OLD.`is_posted` = 0
	AND NEW.`is_posted` = 1
	AND NEW.`source_type` = 'import'
	AND NOT EXISTS (
		SELECT 1
		FROM `import_row_journal_entries`
		WHERE `journal_entry_id` = NEW.`id`
	)
BEGIN
	SELECT RAISE(ABORT, 'import journal entries require a source row link');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_require_transfer_on_insert`
BEFORE INSERT ON `import_transfer_resolutions`
WHEN NOT EXISTS (
	SELECT 1
	FROM `import_row_decisions`
	WHERE `import_row_id` = NEW.`import_row_id`
		AND `disposition` = 'accepted'
		AND `confirmed_type` = 'transfer'
)
OR (
	NEW.`classification` = 'external_out'
	AND (SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`) >= 0
)
OR (
	NEW.`classification` = 'external_in'
	AND (SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`) <= 0
)
OR (
	NEW.`counterpart_import_row_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `import_rows` AS `source_row`
		INNER JOIN `import_batches` AS `source_batch`
			ON `source_batch`.`id` = `source_row`.`import_batch_id`
		INNER JOIN `import_rows` AS `counterpart_row`
			ON `counterpart_row`.`id` = NEW.`counterpart_import_row_id`
		INNER JOIN `import_batches` AS `counterpart_batch`
			ON `counterpart_batch`.`id` = `counterpart_row`.`import_batch_id`
		INNER JOIN `import_row_decisions` AS `counterpart_decision`
			ON `counterpart_decision`.`import_row_id` = `counterpart_row`.`id`
		WHERE `source_row`.`id` = NEW.`import_row_id`
			AND `counterpart_decision`.`disposition` = 'accepted'
			AND `counterpart_decision`.`confirmed_type` = 'transfer'
			AND `source_batch`.`financial_account_id` != `counterpart_batch`.`financial_account_id`
			AND `source_row`.`currency` = `counterpart_row`.`currency`
			AND `source_row`.`amount_minor` = -`counterpart_row`.`amount_minor`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'transfer resolution is inconsistent with its source rows');
END;--> statement-breakpoint
DROP TRIGGER `journal_entries_prevent_archived_account_posting`;--> statement-breakpoint
CREATE TRIGGER `journal_entries_prevent_archived_account_posting`
BEFORE UPDATE OF `is_posted` ON `journal_entries`
WHEN OLD.`is_posted` = 0
	AND NEW.`is_posted` = 1
	AND EXISTS (
		SELECT 1
		FROM `postings`
		INNER JOIN `ledger_accounts`
			ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
		INNER JOIN `financial_accounts`
			ON `financial_accounts`.`id` = `ledger_accounts`.`financial_account_id`
		WHERE `postings`.`journal_entry_id` = NEW.`id`
			AND `financial_accounts`.`archived_at` IS NOT NULL
	)
	AND NOT (
		NEW.`source_type` = 'import'
		AND EXISTS (
			SELECT 1
			FROM `import_row_journal_entries`
			INNER JOIN `import_rows`
				ON `import_rows`.`id` = `import_row_journal_entries`.`import_row_id`
			INNER JOIN `import_batches`
				ON `import_batches`.`id` = `import_rows`.`import_batch_id`
			INNER JOIN `ledger_accounts`
				ON `ledger_accounts`.`financial_account_id` = `import_batches`.`financial_account_id`
			INNER JOIN `postings`
				ON `postings`.`ledger_account_id` = `ledger_accounts`.`id`
				AND `postings`.`journal_entry_id` = NEW.`id`
			WHERE `import_row_journal_entries`.`journal_entry_id` = NEW.`id`
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'cannot post to an archived financial account');
END;--> statement-breakpoint
DROP TRIGGER `journal_entries_prevent_archived_category_posting`;--> statement-breakpoint
CREATE TRIGGER `journal_entries_prevent_archived_category_posting`
BEFORE UPDATE OF `is_posted` ON `journal_entries`
WHEN OLD.`is_posted` = 0
	AND NEW.`is_posted` = 1
	AND EXISTS (
		SELECT 1
		FROM `postings`
		INNER JOIN `ledger_accounts`
			ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
		INNER JOIN `categories`
			ON `categories`.`id` = `ledger_accounts`.`category_id`
		WHERE `postings`.`journal_entry_id` = NEW.`id`
			AND `categories`.`archived_at` IS NOT NULL
	)
	AND NOT (
		NEW.`source_type` = 'import'
		AND NOT EXISTS (
			SELECT 1
			FROM `postings`
			INNER JOIN `ledger_accounts`
				ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
			INNER JOIN `categories`
				ON `categories`.`id` = `ledger_accounts`.`category_id`
			WHERE `postings`.`journal_entry_id` = NEW.`id`
				AND `categories`.`archived_at` IS NOT NULL
				AND NOT EXISTS (
					SELECT 1
					FROM `import_row_journal_entries`
					INNER JOIN `import_row_category_allocations`
						ON `import_row_category_allocations`.`import_row_id` = `import_row_journal_entries`.`import_row_id`
						AND `import_row_category_allocations`.`category_id` = `categories`.`id`
					WHERE `import_row_journal_entries`.`journal_entry_id` = NEW.`id`
				)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'cannot post to an archived category');
END;