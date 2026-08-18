CREATE TRIGGER `app_settings_prevent_delete_with_data`
BEFORE DELETE ON `app_settings`
WHEN (
	EXISTS (SELECT 1 FROM `financial_accounts`)
	OR EXISTS (SELECT 1 FROM `journal_entries`)
	OR EXISTS (SELECT 1 FROM `import_batches`)
)
BEGIN
	SELECT RAISE(ABORT, 'base currency settings cannot be deleted after financial data exists');
END;