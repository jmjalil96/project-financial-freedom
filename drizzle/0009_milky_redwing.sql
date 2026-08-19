CREATE TEMP TABLE `_phase4_decision_migration_guard` (
	`must_be_zero` integer NOT NULL CHECK (`must_be_zero` = 0)
);--> statement-breakpoint
INSERT INTO `_phase4_decision_migration_guard` (`must_be_zero`)
SELECT 1
WHERE EXISTS (
	SELECT 1
	FROM `import_row_decisions`
	INNER JOIN `import_rows`
		ON `import_rows`.`id` = `import_row_decisions`.`import_row_id`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	INNER JOIN `financial_accounts`
		ON `financial_accounts`.`id` = `import_batches`.`financial_account_id`
	WHERE (
		`import_row_decisions`.`disposition` = 'excluded'
		AND (
			`import_row_decisions`.`exclusion_reason` IS NULL
			OR length(trim(`import_row_decisions`.`exclusion_reason`)) = 0
		)
	) OR (
		`import_row_decisions`.`effective_date` IS NOT NULL
		AND (
			`import_row_decisions`.`effective_date` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
			OR strftime('%Y-%m-%d', `import_row_decisions`.`effective_date`, '+0 days') IS NULL
			OR strftime('%Y-%m-%d', `import_row_decisions`.`effective_date`, '+0 days') != `import_row_decisions`.`effective_date`
		)
	) OR (
		`import_row_decisions`.`disposition` = 'accepted'
		AND (
			`import_row_decisions`.`effective_date` IS NULL
			OR `import_row_decisions`.`effective_date` < `financial_accounts`.`opening_date`
		)
	)
);--> statement-breakpoint
DROP TABLE `_phase4_decision_migration_guard`;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `duplicate_scan_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_require_valid_details_on_insert`
BEFORE INSERT ON `import_row_decisions`
WHEN (
	NEW.`disposition` = 'excluded'
	AND (
		NEW.`exclusion_reason` IS NULL
		OR length(trim(NEW.`exclusion_reason`)) = 0
	)
) OR (
	NEW.`effective_date` IS NOT NULL
	AND (
		NEW.`effective_date` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		OR strftime('%Y-%m-%d', NEW.`effective_date`, '+0 days') IS NULL
		OR strftime('%Y-%m-%d', NEW.`effective_date`, '+0 days') != NEW.`effective_date`
	)
) OR (
	NEW.`disposition` = 'accepted'
	AND NEW.`effective_date` IS NULL
) OR (
	NEW.`disposition` = 'accepted'
	AND NEW.`effective_date` < (
		SELECT `financial_accounts`.`opening_date`
		FROM `import_rows`
		INNER JOIN `import_batches`
			ON `import_batches`.`id` = `import_rows`.`import_batch_id`
		INNER JOIN `financial_accounts`
			ON `financial_accounts`.`id` = `import_batches`.`financial_account_id`
		WHERE `import_rows`.`id` = NEW.`import_row_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid import row decision details');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_require_valid_details_on_update`
BEFORE UPDATE OF `disposition`, `effective_date`, `exclusion_reason`, `import_row_id`
ON `import_row_decisions`
WHEN (
	NEW.`disposition` = 'excluded'
	AND (
		NEW.`exclusion_reason` IS NULL
		OR length(trim(NEW.`exclusion_reason`)) = 0
	)
) OR (
	NEW.`effective_date` IS NOT NULL
	AND (
		NEW.`effective_date` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		OR strftime('%Y-%m-%d', NEW.`effective_date`, '+0 days') IS NULL
		OR strftime('%Y-%m-%d', NEW.`effective_date`, '+0 days') != NEW.`effective_date`
	)
) OR (
	NEW.`disposition` = 'accepted'
	AND NEW.`effective_date` IS NULL
) OR (
	NEW.`disposition` = 'accepted'
	AND NEW.`effective_date` < (
		SELECT `financial_accounts`.`opening_date`
		FROM `import_rows`
		INNER JOIN `import_batches`
			ON `import_batches`.`id` = `import_rows`.`import_batch_id`
		INNER JOIN `financial_accounts`
			ON `financial_accounts`.`id` = `import_batches`.`financial_account_id`
		WHERE `import_rows`.`id` = NEW.`import_row_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid import row decision details');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_protect_finalized_canonical_on_update`
BEFORE UPDATE OF `disposition`, `import_row_id` ON `import_row_decisions`
WHEN (
		NEW.`disposition` != 'accepted'
		OR NEW.`import_row_id` != OLD.`import_row_id`
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `import_rows` AS `canonical_row`
		INNER JOIN `import_batches` AS `canonical_batch`
			ON `canonical_batch`.`id` = `canonical_row`.`import_batch_id`
		WHERE `canonical_row`.`id` = OLD.`import_row_id`
			AND `canonical_batch`.`review_status` = 'finalized'
	)
	AND EXISTS (
		SELECT 1
		FROM `import_row_decisions` AS `dependent_decision`
		INNER JOIN `import_rows` AS `dependent_row`
			ON `dependent_row`.`id` = `dependent_decision`.`import_row_id`
		INNER JOIN `import_batches` AS `dependent_batch`
			ON `dependent_batch`.`id` = `dependent_row`.`import_batch_id`
		WHERE `dependent_decision`.`disposition` = 'duplicate'
			AND `dependent_decision`.`duplicate_of_import_row_id` = OLD.`import_row_id`
			AND `dependent_batch`.`review_status` = 'finalized'
	)
BEGIN
	SELECT RAISE(ABORT, 'canonical rows referenced by finalized batches must remain accepted');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_protect_finalized_canonical_on_delete`
BEFORE DELETE ON `import_row_decisions`
WHEN NOT EXISTS (
	SELECT 1
	FROM `import_rows` AS `canonical_row`
	INNER JOIN `import_batches` AS `canonical_batch`
		ON `canonical_batch`.`id` = `canonical_row`.`import_batch_id`
	WHERE `canonical_row`.`id` = OLD.`import_row_id`
		AND `canonical_batch`.`review_status` = 'finalized'
)
AND EXISTS (
	SELECT 1
	FROM `import_row_decisions` AS `dependent_decision`
	INNER JOIN `import_rows` AS `dependent_row`
		ON `dependent_row`.`id` = `dependent_decision`.`import_row_id`
	INNER JOIN `import_batches` AS `dependent_batch`
		ON `dependent_batch`.`id` = `dependent_row`.`import_batch_id`
	WHERE `dependent_decision`.`disposition` = 'duplicate'
		AND `dependent_decision`.`duplicate_of_import_row_id` = OLD.`import_row_id`
		AND `dependent_batch`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'canonical rows referenced by finalized batches must remain accepted');
END;