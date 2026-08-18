CREATE TRIGGER `import_rows_prevent_updates`
BEFORE UPDATE ON `import_rows`
BEGIN
	SELECT RAISE(ABORT, 'committed import source rows are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_rows_prevent_deletes`
BEFORE DELETE ON `import_rows`
BEGIN
	SELECT RAISE(ABORT, 'committed import source rows cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_prevent_source_updates`
BEFORE UPDATE OF
	`financial_account_id`,
	`source_filename`,
	`file_checksum`,
	`csv_schema_version`,
	`currency`,
	`statement_start_date`,
	`statement_end_date`,
	`opening_balance_minor`,
	`closing_balance_minor`,
	`row_count`,
	`warning_count`,
	`validation_status`,
	`imported_at`
ON `import_batches`
BEGIN
	SELECT RAISE(ABORT, 'committed import source metadata is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_prevent_deletes`
BEFORE DELETE ON `import_batches`
BEGIN
	SELECT RAISE(ABORT, 'committed imports cannot be deleted');
END;