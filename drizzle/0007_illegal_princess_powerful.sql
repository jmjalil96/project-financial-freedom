ALTER TABLE `import_batches` ADD `is_sealed` integer DEFAULT true NOT NULL;
--> statement-breakpoint
DROP TRIGGER `import_rows_prevent_batch_overflow`;
--> statement-breakpoint
CREATE TRIGGER `import_rows_require_open_batch`
BEFORE INSERT ON `import_rows`
WHEN (
	SELECT `is_sealed`
	FROM `import_batches`
	WHERE `id` = NEW.`import_batch_id`
) != 0
BEGIN
	SELECT RAISE(ABORT, 'committed import batch membership is sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_validate_seal`
BEFORE UPDATE OF `is_sealed` ON `import_batches`
WHEN OLD.`is_sealed` = 0
	AND NEW.`is_sealed` = 1
	AND (
		SELECT count(*)
		FROM `import_rows`
		WHERE `import_batch_id` = NEW.`id`
	) != NEW.`row_count`
BEGIN
	SELECT RAISE(ABORT, 'import batch row count must match before sealing');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_prevent_unseal`
BEFORE UPDATE OF `is_sealed` ON `import_batches`
WHEN OLD.`is_sealed` = 1 AND NEW.`is_sealed` != 1
BEGIN
	SELECT RAISE(ABORT, 'committed import batches cannot be unsealed');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_require_boolean_seal`
BEFORE UPDATE OF `is_sealed` ON `import_batches`
WHEN NEW.`is_sealed` NOT IN (0, 1)
BEGIN
	SELECT RAISE(ABORT, 'import batch seal state must be boolean');
END;
--> statement-breakpoint
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
BEGIN
	SELECT RAISE(ABORT, 'cannot post to an archived category');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entries_prevent_reversal_chains`
BEFORE INSERT ON `journal_entries`
WHEN NEW.`reverses_entry_id` IS NOT NULL
	AND (
		SELECT `reverses_entry_id`
		FROM `journal_entries`
		WHERE `id` = NEW.`reverses_entry_id`
	) IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'reversal entries cannot be reversed');
END;