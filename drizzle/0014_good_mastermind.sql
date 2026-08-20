CREATE TABLE `manual_item_valuations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manual_item_id` integer NOT NULL,
	`effective_date` text NOT NULL,
	`value_minor` integer NOT NULL,
	`source_note` text NOT NULL,
	`origin` text NOT NULL,
	`carried_forward_from_valuation_id` integer,
	`supersedes_valuation_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`manual_item_id`) REFERENCES `manual_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`carried_forward_from_valuation_id`) REFERENCES `manual_item_valuations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_valuation_id`) REFERENCES `manual_item_valuations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manual_item_valuations_effective_date" CHECK("manual_item_valuations"."effective_date" GLOB '????-??-??'),
	CONSTRAINT "manual_item_valuations_source_note_not_blank" CHECK(length(trim("manual_item_valuations"."source_note")) > 0),
	CONSTRAINT "manual_item_valuations_origin" CHECK("manual_item_valuations"."origin" IN ('manual', 'imported')),
	CONSTRAINT "manual_item_valuations_not_self_referential" CHECK(("manual_item_valuations"."carried_forward_from_valuation_id" IS NULL OR "manual_item_valuations"."carried_forward_from_valuation_id" != "manual_item_valuations"."id")
        AND ("manual_item_valuations"."supersedes_valuation_id" IS NULL OR "manual_item_valuations"."supersedes_valuation_id" != "manual_item_valuations"."id"))
);
--> statement-breakpoint
CREATE INDEX `manual_item_valuations_item_date_index` ON `manual_item_valuations` (`manual_item_id`,`effective_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `manual_item_valuations_supersedes_unique` ON `manual_item_valuations` (`supersedes_valuation_id`);--> statement-breakpoint
CREATE TABLE `manual_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`opening_date` text NOT NULL,
	`valuation_frequency` text NOT NULL,
	`archived_at` text,
	`archived_on` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "manual_items_name_not_blank" CHECK(length(trim("manual_items"."name")) > 0),
	CONSTRAINT "manual_items_normalized_name_not_blank" CHECK(length(trim("manual_items"."normalized_name")) > 0),
	CONSTRAINT "manual_items_kind" CHECK("manual_items"."kind" IN ('asset', 'liability')),
	CONSTRAINT "manual_items_opening_date" CHECK("manual_items"."opening_date" GLOB '????-??-??'),
	CONSTRAINT "manual_items_valuation_frequency" CHECK("manual_items"."valuation_frequency" IN ('monthly', 'quarterly', 'annual', 'ad_hoc')),
	CONSTRAINT "manual_items_archived_on" CHECK("manual_items"."archived_on" IS NULL OR (
        "manual_items"."archived_at" IS NOT NULL
        AND "manual_items"."archived_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND strftime('%Y-%m-%d', "manual_items"."archived_on", '+0 days') = "manual_items"."archived_on"
        AND "manual_items"."archived_on" >= "manual_items"."opening_date"
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_items_normalized_name_unique` ON `manual_items` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `manual_items_kind_archived_index` ON `manual_items` (`kind`,`archived_at`);--> statement-breakpoint
ALTER TABLE `import_transfer_resolutions` ADD `manual_item_id` integer REFERENCES manual_items(id);--> statement-breakpoint
CREATE INDEX `import_transfer_resolutions_manual_item_index` ON `import_transfer_resolutions` (`manual_item_id`);--> statement-breakpoint
CREATE TRIGGER `manual_items_validate_dates_on_insert`
BEFORE INSERT ON `manual_items`
WHEN NEW.`opening_date` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
	OR strftime('%Y-%m-%d', NEW.`opening_date`, '+0 days') IS NULL
	OR strftime('%Y-%m-%d', NEW.`opening_date`, '+0 days') != NEW.`opening_date`
	OR (NEW.`archived_on` IS NOT NULL AND (
		NEW.`archived_at` IS NULL
		OR NEW.`archived_on` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') IS NULL
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') != NEW.`archived_on`
		OR NEW.`archived_on` < NEW.`opening_date`
	))
BEGIN
	SELECT RAISE(ABORT, 'manual item dates are invalid');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_validate_dates_on_update`
BEFORE UPDATE OF `opening_date`, `archived_at`, `archived_on` ON `manual_items`
WHEN NEW.`opening_date` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
	OR strftime('%Y-%m-%d', NEW.`opening_date`, '+0 days') IS NULL
	OR strftime('%Y-%m-%d', NEW.`opening_date`, '+0 days') != NEW.`opening_date`
	OR (NEW.`archived_on` IS NOT NULL AND (
		NEW.`archived_at` IS NULL
		OR NEW.`archived_on` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') IS NULL
		OR strftime('%Y-%m-%d', NEW.`archived_on`, '+0 days') != NEW.`archived_on`
		OR NEW.`archived_on` < NEW.`opening_date`
		OR EXISTS (
			SELECT 1 FROM `manual_item_valuations`
			WHERE `manual_item_id` = OLD.`id`
				AND `effective_date` > NEW.`archived_on`
		)
	))
BEGIN
	SELECT RAISE(ABORT, 'manual item dates are invalid');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_prevent_financial_account_overlap_on_insert`
BEFORE INSERT ON `manual_items`
WHEN EXISTS (
	SELECT 1 FROM `financial_accounts`
	WHERE lower(trim(`name`)) = lower(trim(NEW.`name`))
)
BEGIN
	SELECT RAISE(ABORT, 'a financial item cannot be both a tracked account and a manual item');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_prevent_financial_account_overlap_on_update`
BEFORE UPDATE OF `name` ON `manual_items`
WHEN EXISTS (
	SELECT 1 FROM `financial_accounts`
	WHERE lower(trim(`name`)) = lower(trim(NEW.`name`))
)
BEGIN
	SELECT RAISE(ABORT, 'a financial item cannot be both a tracked account and a manual item');
END;--> statement-breakpoint
CREATE TRIGGER `financial_accounts_prevent_manual_item_overlap_on_insert`
BEFORE INSERT ON `financial_accounts`
WHEN EXISTS (
	SELECT 1 FROM `manual_items`
	WHERE lower(trim(`name`)) = lower(trim(NEW.`name`))
)
BEGIN
	SELECT RAISE(ABORT, 'a financial item cannot be both a tracked account and a manual item');
END;--> statement-breakpoint
CREATE TRIGGER `financial_accounts_prevent_manual_item_overlap_on_update`
BEFORE UPDATE OF `name` ON `financial_accounts`
WHEN EXISTS (
	SELECT 1 FROM `manual_items`
	WHERE lower(trim(`name`)) = lower(trim(NEW.`name`))
)
BEGIN
	SELECT RAISE(ABORT, 'a financial item cannot be both a tracked account and a manual item');
END;--> statement-breakpoint
CREATE TRIGGER `manual_item_valuations_validate_on_insert`
BEFORE INSERT ON `manual_item_valuations`
WHEN NEW.`effective_date` NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
	OR strftime('%Y-%m-%d', NEW.`effective_date`, '+0 days') IS NULL
	OR strftime('%Y-%m-%d', NEW.`effective_date`, '+0 days') != NEW.`effective_date`
	OR NOT EXISTS (
		SELECT 1 FROM `manual_items`
		WHERE `id` = NEW.`manual_item_id`
			AND `archived_at` IS NULL
			AND NEW.`effective_date` >= `opening_date`
			AND ((`kind` = 'asset' AND NEW.`value_minor` >= 0)
				OR (`kind` = 'liability' AND NEW.`value_minor` <= 0))
	)
	OR (NEW.`carried_forward_from_valuation_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM `manual_item_valuations` AS `source`
		WHERE `source`.`id` = NEW.`carried_forward_from_valuation_id`
			AND `source`.`manual_item_id` = NEW.`manual_item_id`
			AND `source`.`value_minor` = NEW.`value_minor`
			AND `source`.`effective_date` < NEW.`effective_date`
			AND NOT EXISTS (
				SELECT 1 FROM `manual_item_valuations` AS `replacement`
				WHERE `replacement`.`supersedes_valuation_id` = `source`.`id`
			)
	))
	OR (NEW.`supersedes_valuation_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM `manual_item_valuations` AS `prior`
		WHERE `prior`.`id` = NEW.`supersedes_valuation_id`
			AND `prior`.`manual_item_id` = NEW.`manual_item_id`
			AND `prior`.`effective_date` = NEW.`effective_date`
	))
	OR (NEW.`supersedes_valuation_id` IS NULL AND EXISTS (
		SELECT 1
		FROM `manual_item_valuations` AS `current_value`
		WHERE `current_value`.`manual_item_id` = NEW.`manual_item_id`
			AND `current_value`.`effective_date` = NEW.`effective_date`
			AND NOT EXISTS (
				SELECT 1 FROM `manual_item_valuations` AS `replacement`
				WHERE `replacement`.`supersedes_valuation_id` = `current_value`.`id`
			)
	))
BEGIN
	SELECT RAISE(ABORT, 'manual valuation is inconsistent with its item or history');
END;--> statement-breakpoint
CREATE TRIGGER `manual_item_valuations_prevent_update`
BEFORE UPDATE ON `manual_item_valuations`
BEGIN
	SELECT RAISE(ABORT, 'manual valuations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `manual_item_valuations_prevent_delete`
BEFORE DELETE ON `manual_item_valuations`
BEGIN
	SELECT RAISE(ABORT, 'manual valuations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_protect_valued_identity_on_update`
BEFORE UPDATE OF `kind`, `opening_date` ON `manual_items`
WHEN EXISTS (
	SELECT 1 FROM `manual_item_valuations`
	WHERE `manual_item_id` = OLD.`id`
)
	AND (NEW.`kind` IS NOT OLD.`kind` OR NEW.`opening_date` IS NOT OLD.`opening_date`)
BEGIN
	SELECT RAISE(ABORT, 'a valued manual item cannot change kind or opening date');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_prevent_delete`
BEFORE DELETE ON `manual_items`
BEGIN
	SELECT RAISE(ABORT, 'manual items are archived rather than deleted');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_validate_manual_item_link_on_insert`
BEFORE INSERT ON `import_transfer_resolutions`
WHEN NEW.`manual_item_id` IS NOT NULL
	AND (
		NEW.`classification` NOT IN ('external_out', 'external_in')
		OR NEW.`reclassification_journal_entry_id` IS NULL
		OR NOT EXISTS (
			SELECT 1
			FROM `journal_entries`
			INNER JOIN `postings`
				ON `postings`.`journal_entry_id` = `journal_entries`.`id`
			INNER JOIN `ledger_accounts`
				ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
			WHERE `journal_entries`.`id` = NEW.`reclassification_journal_entry_id`
				AND `journal_entries`.`is_posted` = 1
				AND `ledger_accounts`.`system_key` = 'outside_scope_transfers'
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'only posted outside-scope transfers can link to manual items');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_validate_manual_item_link_on_update`
BEFORE UPDATE OF `classification`, `reclassification_journal_entry_id`, `manual_item_id`
	ON `import_transfer_resolutions`
WHEN NEW.`manual_item_id` IS NOT NULL
	AND (
		NEW.`classification` NOT IN ('external_out', 'external_in')
		OR NEW.`reclassification_journal_entry_id` IS NULL
		OR NOT EXISTS (
			SELECT 1
			FROM `journal_entries`
			INNER JOIN `postings`
				ON `postings`.`journal_entry_id` = `journal_entries`.`id`
			INNER JOIN `ledger_accounts`
				ON `ledger_accounts`.`id` = `postings`.`ledger_account_id`
			WHERE `journal_entries`.`id` = NEW.`reclassification_journal_entry_id`
				AND `journal_entries`.`is_posted` = 1
				AND `ledger_accounts`.`system_key` = 'outside_scope_transfers'
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'only posted outside-scope transfers can link to manual items');
END;
