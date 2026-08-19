ALTER TABLE `import_transfer_resolutions` ADD `reclassification_journal_entry_id` integer REFERENCES journal_entries(id);--> statement-breakpoint
CREATE UNIQUE INDEX `import_transfer_resolutions_reclassification_entry_unique` ON `import_transfer_resolutions` (`reclassification_journal_entry_id`);--> statement-breakpoint
CREATE TEMP TABLE `_pff_phase5_direction_guard` (`value` integer);--> statement-breakpoint
CREATE TEMP TRIGGER `_pff_phase5_direction_guard_trigger`
BEFORE INSERT ON `_pff_phase5_direction_guard`
WHEN EXISTS (
	SELECT 1
	FROM `import_row_decisions` AS `decision`
	INNER JOIN `import_rows` AS `source`
		ON `source`.`id` = `decision`.`import_row_id`
	WHERE `decision`.`disposition` = 'accepted'
		AND (
			(`decision`.`confirmed_type` = 'expense' AND `source`.`amount_minor` >= 0)
			OR (`decision`.`confirmed_type` IN ('income', 'refund') AND `source`.`amount_minor` <= 0)
		)
)
BEGIN
	SELECT RAISE(ABORT, 'accepted income, expense, or refund rows have invalid amount directions');
END;--> statement-breakpoint
INSERT INTO `_pff_phase5_direction_guard` (`value`) VALUES (1);--> statement-breakpoint
DROP TRIGGER `_pff_phase5_direction_guard_trigger`;--> statement-breakpoint
DROP TABLE `_pff_phase5_direction_guard`;--> statement-breakpoint
INSERT INTO `ledger_accounts` (`name`, `kind`, `system_key`)
VALUES ('Outside-scope transfers', 'clearing', 'outside_scope_transfers')
ON CONFLICT (`system_key`) DO NOTHING;--> statement-breakpoint
CREATE TEMP TABLE `_pff_external_transfer_backfill` (
	`resolution_id` integer PRIMARY KEY,
	`import_row_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`effective_date` text NOT NULL,
	`description` text NOT NULL,
	`journal_entry_id` integer NOT NULL UNIQUE
);--> statement-breakpoint
INSERT INTO `_pff_external_transfer_backfill` (
	`resolution_id`,
	`import_row_id`,
	`amount_minor`,
	`effective_date`,
	`description`,
	`journal_entry_id`
)
SELECT
	`resolution`.`id`,
	`source`.`id`,
	`source`.`amount_minor`,
	`decision`.`effective_date`,
	`source`.`description`,
	(SELECT coalesce(max(`id`), 0) FROM `journal_entries`)
		+ row_number() OVER (ORDER BY `resolution`.`id`)
FROM `import_transfer_resolutions` AS `resolution`
INNER JOIN `import_rows` AS `source`
	ON `source`.`id` = `resolution`.`import_row_id`
INNER JOIN `import_row_decisions` AS `decision`
	ON `decision`.`import_row_id` = `source`.`id`
INNER JOIN `import_batches` AS `batch`
	ON `batch`.`id` = `source`.`import_batch_id`
WHERE `resolution`.`classification` IN ('external_out', 'external_in')
	AND `resolution`.`reclassification_journal_entry_id` IS NULL
	AND `batch`.`ledger_posted_at` IS NOT NULL;--> statement-breakpoint
INSERT INTO `journal_entries` (
	`id`,
	`effective_date`,
	`description`,
	`source_type`,
	`notes`,
	`is_posted`,
	`posted_at`
)
SELECT
	`journal_entry_id`,
	`effective_date`,
	'Outside-scope transfer — ' || `description`,
	'system',
	'Reclassified from transfer clearing after confirming an owned account outside this workspace.',
	0,
	NULL
FROM `_pff_external_transfer_backfill`;--> statement-breakpoint
INSERT INTO `postings` (`journal_entry_id`, `ledger_account_id`, `amount_minor`, `memo`)
SELECT
	`backfill`.`journal_entry_id`,
	`ledger`.`id`,
	`backfill`.`amount_minor`,
	'Resolved outside the tracked account set'
FROM `_pff_external_transfer_backfill` AS `backfill`
INNER JOIN `ledger_accounts` AS `ledger`
	ON `ledger`.`system_key` = 'transfer_clearing'
UNION ALL
SELECT
	`backfill`.`journal_entry_id`,
	`ledger`.`id`,
	-`backfill`.`amount_minor`,
	'Owned account outside this workspace'
FROM `_pff_external_transfer_backfill` AS `backfill`
INNER JOIN `ledger_accounts` AS `ledger`
	ON `ledger`.`system_key` = 'outside_scope_transfers';--> statement-breakpoint
UPDATE `journal_entries`
SET `is_posted` = 1, `posted_at` = CURRENT_TIMESTAMP
WHERE `id` IN (
	SELECT `journal_entry_id` FROM `_pff_external_transfer_backfill`
);--> statement-breakpoint
UPDATE `import_transfer_resolutions`
SET `reclassification_journal_entry_id` = (
	SELECT `journal_entry_id`
	FROM `_pff_external_transfer_backfill`
	WHERE `_pff_external_transfer_backfill`.`resolution_id` = `import_transfer_resolutions`.`id`
)
WHERE `id` IN (
	SELECT `resolution_id` FROM `_pff_external_transfer_backfill`
);--> statement-breakpoint
DROP TABLE `_pff_external_transfer_backfill`;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_require_amount_direction_on_insert`
BEFORE INSERT ON `import_row_decisions`
WHEN NEW.`disposition` = 'accepted'
	AND (
		(NEW.`confirmed_type` = 'expense' AND (
			SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
		) >= 0)
		OR (NEW.`confirmed_type` IN ('income', 'refund') AND (
			SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
		) <= 0)
	)
BEGIN
	SELECT RAISE(ABORT, 'accepted transaction type does not match the source amount direction');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_require_amount_direction_on_update`
BEFORE UPDATE OF `import_row_id`, `disposition`, `confirmed_type` ON `import_row_decisions`
WHEN NEW.`disposition` = 'accepted'
	AND (
		(NEW.`confirmed_type` = 'expense' AND (
			SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
		) >= 0)
		OR (NEW.`confirmed_type` IN ('income', 'refund') AND (
			SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
		) <= 0)
	)
BEGIN
	SELECT RAISE(ABORT, 'accepted transaction type does not match the source amount direction');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_validate_reclassification_on_insert`
BEFORE INSERT ON `import_transfer_resolutions`
WHEN (
	NEW.`classification` IN ('external_out', 'external_in')
	AND EXISTS (
		SELECT 1 FROM `import_row_journal_entries`
		WHERE `import_row_id` = NEW.`import_row_id`
	)
	AND NEW.`reclassification_journal_entry_id` IS NULL
)
OR (
	NEW.`classification` NOT IN ('external_out', 'external_in')
	AND NEW.`reclassification_journal_entry_id` IS NOT NULL
)
OR (
	NEW.`reclassification_journal_entry_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `journal_entries` AS `entry`
		WHERE `entry`.`id` = NEW.`reclassification_journal_entry_id`
			AND `entry`.`source_type` = 'system'
			AND `entry`.`is_posted` = 1
			AND `entry`.`reverses_entry_id` IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM `journal_entries` AS `reversal`
				WHERE `reversal`.`reverses_entry_id` = `entry`.`id`
			)
			AND (SELECT count(*) FROM `postings` WHERE `journal_entry_id` = `entry`.`id`) = 2
			AND EXISTS (
				SELECT 1
				FROM `postings`
				INNER JOIN `ledger_accounts`
					ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
				WHERE `postings`.`journal_entry_id` = `entry`.`id`
					AND `ledger_accounts`.`system_key` = 'transfer_clearing'
					AND `postings`.`amount_minor` = (
						SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
					)
			)
			AND EXISTS (
				SELECT 1
				FROM `postings`
				INNER JOIN `ledger_accounts`
					ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
				WHERE `postings`.`journal_entry_id` = `entry`.`id`
					AND `ledger_accounts`.`system_key` = 'outside_scope_transfers'
					AND `postings`.`amount_minor` = -(
						SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
					)
			)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'outside-scope transfer reclassification is missing or invalid');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_validate_reclassification_on_update`
BEFORE UPDATE ON `import_transfer_resolutions`
WHEN (
	NEW.`classification` IN ('external_out', 'external_in')
	AND EXISTS (
		SELECT 1 FROM `import_row_journal_entries`
		WHERE `import_row_id` = NEW.`import_row_id`
	)
	AND NEW.`reclassification_journal_entry_id` IS NULL
)
OR (
	NEW.`classification` NOT IN ('external_out', 'external_in')
	AND NEW.`reclassification_journal_entry_id` IS NOT NULL
)
OR (
	NEW.`reclassification_journal_entry_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `journal_entries` AS `entry`
		WHERE `entry`.`id` = NEW.`reclassification_journal_entry_id`
			AND `entry`.`source_type` = 'system'
			AND `entry`.`is_posted` = 1
			AND `entry`.`reverses_entry_id` IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM `journal_entries` AS `reversal`
				WHERE `reversal`.`reverses_entry_id` = `entry`.`id`
			)
			AND (SELECT count(*) FROM `postings` WHERE `journal_entry_id` = `entry`.`id`) = 2
			AND EXISTS (
				SELECT 1
				FROM `postings`
				INNER JOIN `ledger_accounts`
					ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
				WHERE `postings`.`journal_entry_id` = `entry`.`id`
					AND `ledger_accounts`.`system_key` = 'transfer_clearing'
					AND `postings`.`amount_minor` = (
						SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
					)
			)
			AND EXISTS (
				SELECT 1
				FROM `postings`
				INNER JOIN `ledger_accounts`
					ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
				WHERE `postings`.`journal_entry_id` = `entry`.`id`
					AND `ledger_accounts`.`system_key` = 'outside_scope_transfers'
					AND `postings`.`amount_minor` = -(
						SELECT `amount_minor` FROM `import_rows` WHERE `id` = NEW.`import_row_id`
					)
			)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'outside-scope transfer reclassification is missing or invalid');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_prevent_reclassification_change`
BEFORE UPDATE OF `reclassification_journal_entry_id` ON `import_transfer_resolutions`
WHEN OLD.`reclassification_journal_entry_id` IS NOT NULL
	AND NEW.`reclassification_journal_entry_id` IS NOT OLD.`reclassification_journal_entry_id`
BEGIN
	SELECT RAISE(ABORT, 'outside-scope transfer reclassification links are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_require_reclassification_reversal_on_delete`
BEFORE DELETE ON `import_transfer_resolutions`
WHEN OLD.`reclassification_journal_entry_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `journal_entries`
		WHERE `reverses_entry_id` = OLD.`reclassification_journal_entry_id`
			AND `is_posted` = 1
	)
BEGIN
	SELECT RAISE(ABORT, 'reverse the outside-scope transfer reclassification before clearing it');
END;--> statement-breakpoint
CREATE TRIGGER `import_batches_require_external_transfer_reclassifications`
BEFORE UPDATE OF `ledger_posted_at` ON `import_batches`
WHEN OLD.`ledger_posted_at` IS NULL
	AND NEW.`ledger_posted_at` IS NOT NULL
	AND EXISTS (
		SELECT 1
		FROM `import_rows`
		INNER JOIN `import_transfer_resolutions`
			ON `import_transfer_resolutions`.`import_row_id` = `import_rows`.`id`
		WHERE `import_rows`.`import_batch_id` = NEW.`id`
			AND `import_transfer_resolutions`.`classification` IN ('external_out', 'external_in')
			AND `import_transfer_resolutions`.`reclassification_journal_entry_id` IS NULL
	)
BEGIN
	SELECT RAISE(ABORT, 'posted external transfers require outside-scope reclassification links');
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
BEGIN
	SELECT RAISE(ABORT, 'cannot post to an archived financial account');
END;
