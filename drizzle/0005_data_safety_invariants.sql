CREATE TRIGGER `app_settings_prevent_base_currency_change_with_data`
BEFORE UPDATE OF `base_currency` ON `app_settings`
WHEN OLD.`base_currency` <> NEW.`base_currency`
	AND (
		EXISTS (SELECT 1 FROM `financial_accounts`)
		OR EXISTS (SELECT 1 FROM `journal_entries`)
		OR EXISTS (SELECT 1 FROM `import_batches`)
	)
BEGIN
	SELECT RAISE(ABORT, 'base currency cannot change after financial data exists');
END;
--> statement-breakpoint
CREATE TRIGGER `import_rows_prevent_batch_overflow`
BEFORE INSERT ON `import_rows`
WHEN (
	SELECT count(*)
	FROM `import_rows`
	WHERE `import_batch_id` = NEW.`import_batch_id`
) >= (
	SELECT `row_count`
	FROM `import_batches`
	WHERE `id` = NEW.`import_batch_id`
)
BEGIN
	SELECT RAISE(ABORT, 'committed import batch membership is sealed');
END;
--> statement-breakpoint
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
BEGIN
	SELECT RAISE(ABORT, 'cannot post to an archived financial account');
END;