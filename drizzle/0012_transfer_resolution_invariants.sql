DROP TRIGGER `import_transfer_resolutions_require_transfer_on_insert`;--> statement-breakpoint
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
		INNER JOIN `financial_accounts` AS `source_account`
			ON `source_account`.`id` = `source_batch`.`financial_account_id`
		INNER JOIN `import_rows` AS `counterpart_row`
			ON `counterpart_row`.`id` = NEW.`counterpart_import_row_id`
		INNER JOIN `import_batches` AS `counterpart_batch`
			ON `counterpart_batch`.`id` = `counterpart_row`.`import_batch_id`
		INNER JOIN `financial_accounts` AS `counterpart_account`
			ON `counterpart_account`.`id` = `counterpart_batch`.`financial_account_id`
		INNER JOIN `import_row_decisions` AS `counterpart_decision`
			ON `counterpart_decision`.`import_row_id` = `counterpart_row`.`id`
		WHERE `source_row`.`id` = NEW.`import_row_id`
			AND `counterpart_decision`.`disposition` = 'accepted'
			AND `counterpart_decision`.`confirmed_type` = 'transfer'
			AND `source_batch`.`financial_account_id` != `counterpart_batch`.`financial_account_id`
			AND `source_row`.`currency` = `counterpart_row`.`currency`
			AND `source_row`.`amount_minor` = -`counterpart_row`.`amount_minor`
			AND abs(
				julianday(`source_row`.`transaction_date`)
				- julianday(`counterpart_row`.`transaction_date`)
			) <= 3
			AND (
				(
					NEW.`classification` = 'card_payment'
					AND (`source_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
						!= (`counterpart_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
				) OR (
					NEW.`classification` = 'owned_account'
					AND (`source_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
						= (`counterpart_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
				)
			)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'transfer resolution is inconsistent with its source rows');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_require_transfer_on_update`
BEFORE UPDATE ON `import_transfer_resolutions`
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
		INNER JOIN `financial_accounts` AS `source_account`
			ON `source_account`.`id` = `source_batch`.`financial_account_id`
		INNER JOIN `import_rows` AS `counterpart_row`
			ON `counterpart_row`.`id` = NEW.`counterpart_import_row_id`
		INNER JOIN `import_batches` AS `counterpart_batch`
			ON `counterpart_batch`.`id` = `counterpart_row`.`import_batch_id`
		INNER JOIN `financial_accounts` AS `counterpart_account`
			ON `counterpart_account`.`id` = `counterpart_batch`.`financial_account_id`
		INNER JOIN `import_row_decisions` AS `counterpart_decision`
			ON `counterpart_decision`.`import_row_id` = `counterpart_row`.`id`
		WHERE `source_row`.`id` = NEW.`import_row_id`
			AND `counterpart_decision`.`disposition` = 'accepted'
			AND `counterpart_decision`.`confirmed_type` = 'transfer'
			AND `source_batch`.`financial_account_id` != `counterpart_batch`.`financial_account_id`
			AND `source_row`.`currency` = `counterpart_row`.`currency`
			AND `source_row`.`amount_minor` = -`counterpart_row`.`amount_minor`
			AND abs(
				julianday(`source_row`.`transaction_date`)
				- julianday(`counterpart_row`.`transaction_date`)
			) <= 3
			AND (
				(
					NEW.`classification` = 'card_payment'
					AND (`source_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
						!= (`counterpart_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
				) OR (
					NEW.`classification` = 'owned_account'
					AND (`source_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
						= (`counterpart_account`.`type` IN ('credit_card', 'loan', 'other_liability'))
				)
			)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'transfer resolution is inconsistent with its source rows');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_protect_transfer_resolution_on_update`
BEFORE UPDATE OF `import_row_id`, `disposition`, `confirmed_type` ON `import_row_decisions`
WHEN EXISTS (
	SELECT 1
	FROM `import_transfer_resolutions`
	WHERE `import_row_id` = OLD.`import_row_id`
		OR `counterpart_import_row_id` = OLD.`import_row_id`
)
AND (
	NEW.`import_row_id` != OLD.`import_row_id`
	OR NEW.`disposition` != 'accepted'
	OR NEW.`confirmed_type` != 'transfer'
)
BEGIN
	SELECT RAISE(ABORT, 'clear the transfer resolution before changing its review decision');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_protect_transfer_resolution_on_delete`
BEFORE DELETE ON `import_row_decisions`
WHEN EXISTS (
	SELECT 1
	FROM `import_transfer_resolutions`
	WHERE `import_row_id` = OLD.`import_row_id`
		OR `counterpart_import_row_id` = OLD.`import_row_id`
)
BEGIN
	SELECT RAISE(ABORT, 'clear the transfer resolution before deleting its review decision');
END;
