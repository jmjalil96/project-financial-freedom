CREATE TABLE `month_close_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_month` text NOT NULL,
	`revision_number` integer NOT NULL,
	`previous_revision_id` integer,
	`ledger_cutoff_entry_id` integer,
	`income_minor` integer NOT NULL,
	`expenses_minor` integer NOT NULL,
	`savings_minor` integer NOT NULL,
	`savings_rate_basis_points` integer,
	`budget_planned_minor` integer NOT NULL,
	`budget_actual_minor` integer NOT NULL,
	`debt_minor` integer NOT NULL,
	`debt_change_minor` integer NOT NULL,
	`net_worth_minor` integer NOT NULL,
	`net_worth_change_minor` integer NOT NULL,
	`warning_count` integer NOT NULL,
	`snapshot_version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text NOT NULL,
	`closed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`previous_revision_id`) REFERENCES `month_close_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_cutoff_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "month_close_revisions_target_month" CHECK(length("month_close_revisions"."target_month") = 7
        AND "month_close_revisions"."target_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND CAST(substr("month_close_revisions"."target_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "month_close_revisions_revision_number" CHECK("month_close_revisions"."revision_number" > 0),
	CONSTRAINT "month_close_revisions_previous_not_self" CHECK("month_close_revisions"."previous_revision_id" IS NULL OR "month_close_revisions"."previous_revision_id" != "month_close_revisions"."id"),
	CONSTRAINT "month_close_revisions_warning_count" CHECK("month_close_revisions"."warning_count" >= 0),
	CONSTRAINT "month_close_revisions_snapshot_version" CHECK("month_close_revisions"."snapshot_version" = 1),
	CONSTRAINT "month_close_revisions_snapshot_json" CHECK(json_valid("month_close_revisions"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_close_revisions_month_revision_unique` ON `month_close_revisions` (`target_month`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `month_close_revisions_id_month_unique` ON `month_close_revisions` (`id`,`target_month`);--> statement-breakpoint
CREATE UNIQUE INDEX `month_close_revisions_previous_unique` ON `month_close_revisions` (`previous_revision_id`);--> statement-breakpoint
CREATE INDEX `month_close_revisions_month_closed_index` ON `month_close_revisions` (`target_month`,`closed_at`);--> statement-breakpoint
CREATE TABLE `month_close_states` (
	`target_month` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`active_revision_id` integer,
	`latest_revision_id` integer NOT NULL,
	`last_reopened_at` text,
	`last_reopen_reason` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`active_revision_id`,`target_month`) REFERENCES `month_close_revisions`(`id`,`target_month`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`latest_revision_id`,`target_month`) REFERENCES `month_close_revisions`(`id`,`target_month`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "month_close_states_target_month" CHECK(length("month_close_states"."target_month") = 7
        AND "month_close_states"."target_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND CAST(substr("month_close_states"."target_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "month_close_states_status" CHECK("month_close_states"."status" IN ('closed', 'reopened')),
	CONSTRAINT "month_close_states_details" CHECK((
        "month_close_states"."status" = 'closed'
        AND "month_close_states"."active_revision_id" IS NOT NULL
        AND "month_close_states"."active_revision_id" = "month_close_states"."latest_revision_id"
        AND "month_close_states"."last_reopened_at" IS NULL
        AND "month_close_states"."last_reopen_reason" IS NULL
      ) OR (
        "month_close_states"."status" = 'reopened'
        AND "month_close_states"."active_revision_id" IS NULL
        AND "month_close_states"."last_reopened_at" IS NOT NULL
        AND "month_close_states"."last_reopen_reason" IS NOT NULL
        AND length(trim("month_close_states"."last_reopen_reason")) > 0
      ))
);
--> statement-breakpoint
CREATE INDEX `month_close_states_status_month_index` ON `month_close_states` (`status`,`target_month`);--> statement-breakpoint
CREATE TABLE `monthly_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_month` text NOT NULL,
	`category_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "monthly_budgets_target_month" CHECK(length("monthly_budgets"."target_month") = 7
        AND "monthly_budgets"."target_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND CAST(substr("monthly_budgets"."target_month", 6, 2) AS INTEGER) BETWEEN 1 AND 12),
	CONSTRAINT "monthly_budgets_nonnegative" CHECK("monthly_budgets"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_budgets_month_category_unique` ON `monthly_budgets` (`target_month`,`category_id`);--> statement-breakpoint
CREATE INDEX `monthly_budgets_category_month_index` ON `monthly_budgets` (`category_id`,`target_month`);--> statement-breakpoint
CREATE TRIGGER `month_close_revisions_validate_history_on_insert`
BEFORE INSERT ON `month_close_revisions`
WHEN EXISTS (
		SELECT 1 FROM `month_close_states`
		WHERE `target_month` = NEW.`target_month`
			AND `status` = 'closed'
	)
	OR (NEW.`revision_number` = 1 AND NEW.`previous_revision_id` IS NOT NULL)
	OR (NEW.`revision_number` > 1 AND NEW.`previous_revision_id` IS NULL)
	OR (NEW.`previous_revision_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `month_close_revisions` AS `previous`
		WHERE `previous`.`id` = NEW.`previous_revision_id`
			AND `previous`.`target_month` = NEW.`target_month`
			AND `previous`.`revision_number` = NEW.`revision_number` - 1
	))
BEGIN
	SELECT RAISE(ABORT, 'month-close revision history is inconsistent');
END;--> statement-breakpoint
CREATE TRIGGER `month_close_revisions_prevent_update`
BEFORE UPDATE ON `month_close_revisions`
BEGIN
	SELECT RAISE(ABORT, 'month-close revisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `month_close_revisions_prevent_delete`
BEFORE DELETE ON `month_close_revisions`
BEGIN
	SELECT RAISE(ABORT, 'month-close revisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `month_close_states_prevent_delete`
BEFORE DELETE ON `month_close_states`
BEGIN
	SELECT RAISE(ABORT, 'month-close state history cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `monthly_budgets_validate_on_insert`
BEFORE INSERT ON `monthly_budgets`
WHEN EXISTS (
		SELECT 1 FROM `month_close_states`
		WHERE `target_month` = NEW.`target_month`
			AND `status` = 'closed'
	)
	OR NOT EXISTS (
		SELECT 1 FROM `categories`
		WHERE `id` = NEW.`category_id`
			AND `kind` = 'expense'
			AND `archived_at` IS NULL
	)
BEGIN
	SELECT RAISE(ABORT, 'budgets require an open month and active expense category');
END;--> statement-breakpoint
CREATE TRIGGER `monthly_budgets_validate_on_update`
BEFORE UPDATE ON `monthly_budgets`
WHEN EXISTS (
		SELECT 1 FROM `month_close_states`
		WHERE `target_month` IN (OLD.`target_month`, NEW.`target_month`)
			AND `status` = 'closed'
	)
	OR NOT EXISTS (
		SELECT 1 FROM `categories`
		WHERE `id` = NEW.`category_id`
			AND `kind` = 'expense'
			AND `archived_at` IS NULL
	)
BEGIN
	SELECT RAISE(ABORT, 'budgets require an open month and active expense category');
END;--> statement-breakpoint
CREATE TRIGGER `monthly_budgets_prevent_closed_delete`
BEFORE DELETE ON `monthly_budgets`
WHEN EXISTS (
	SELECT 1 FROM `month_close_states`
	WHERE `target_month` = OLD.`target_month`
		AND `status` = 'closed'
)
BEGIN
	SELECT RAISE(ABORT, 'a closed month budget is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `journal_entries_prevent_closed_month_insert`
BEFORE INSERT ON `journal_entries`
WHEN EXISTS (
	SELECT 1 FROM `month_close_states`
	WHERE `status` = 'closed'
		AND `target_month` >= substr(NEW.`effective_date`, 1, 7)
)
BEGIN
	SELECT RAISE(ABORT, 'the effective month is closed and must be reopened first');
END;--> statement-breakpoint
CREATE TRIGGER `manual_item_valuations_prevent_closed_month_insert`
BEFORE INSERT ON `manual_item_valuations`
WHEN EXISTS (
	SELECT 1 FROM `month_close_states`
	WHERE `status` = 'closed'
		AND `target_month` >= substr(NEW.`effective_date`, 1, 7)
)
BEGIN
	SELECT RAISE(ABORT, 'the valuation month is closed and must be reopened first');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_prevent_closed_manual_link_on_insert`
BEFORE INSERT ON `import_transfer_resolutions`
WHEN NEW.`manual_item_id` IS NOT NULL
	AND EXISTS (
		SELECT 1
		FROM `journal_entries`
		INNER JOIN `month_close_states`
			ON `month_close_states`.`target_month` >= substr(`journal_entries`.`effective_date`, 1, 7)
		WHERE `journal_entries`.`id` = NEW.`reclassification_journal_entry_id`
			AND `month_close_states`.`status` = 'closed'
	)
BEGIN
	SELECT RAISE(ABORT, 'the transfer month is closed and must be reopened first');
END;--> statement-breakpoint
CREATE TRIGGER `import_transfer_resolutions_prevent_closed_manual_link_on_update`
BEFORE UPDATE OF `manual_item_id` ON `import_transfer_resolutions`
WHEN NEW.`manual_item_id` IS NOT OLD.`manual_item_id`
	AND EXISTS (
		SELECT 1
		FROM `journal_entries`
		INNER JOIN `month_close_states`
			ON `month_close_states`.`target_month` >= substr(`journal_entries`.`effective_date`, 1, 7)
		WHERE `journal_entries`.`id` = NEW.`reclassification_journal_entry_id`
			AND `month_close_states`.`status` = 'closed'
	)
BEGIN
	SELECT RAISE(ABORT, 'the transfer month is closed and must be reopened first');
END;--> statement-breakpoint
CREATE TRIGGER `financial_accounts_prevent_closed_historical_insert`
BEFORE INSERT ON `financial_accounts`
WHEN EXISTS (
	SELECT 1 FROM `month_close_states`
	WHERE `status` = 'closed'
		AND `target_month` >= substr(NEW.`opening_date`, 1, 7)
)
BEGIN
	SELECT RAISE(ABORT, 'closed months prevent this account start date');
END;--> statement-breakpoint
CREATE TRIGGER `financial_accounts_prevent_closed_lifecycle_change`
BEFORE UPDATE OF `archived_at`, `archived_on` ON `financial_accounts`
WHEN (NEW.`archived_at` IS NOT OLD.`archived_at` OR NEW.`archived_on` IS NOT OLD.`archived_on`)
	AND EXISTS (
		SELECT 1 FROM `month_close_states`
		WHERE `status` = 'closed'
			AND `target_month` >= substr(coalesce(NEW.`archived_on`, OLD.`archived_on`), 1, 7)
	)
BEGIN
	SELECT RAISE(ABORT, 'closed months prevent this account lifecycle change');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_prevent_closed_historical_insert`
BEFORE INSERT ON `manual_items`
WHEN EXISTS (
	SELECT 1 FROM `month_close_states`
	WHERE `status` = 'closed'
		AND `target_month` >= substr(NEW.`opening_date`, 1, 7)
)
BEGIN
	SELECT RAISE(ABORT, 'closed months prevent this manual-item start date');
END;--> statement-breakpoint
CREATE TRIGGER `manual_items_prevent_closed_lifecycle_change`
BEFORE UPDATE OF `archived_at`, `archived_on` ON `manual_items`
WHEN (NEW.`archived_at` IS NOT OLD.`archived_at` OR NEW.`archived_on` IS NOT OLD.`archived_on`)
	AND EXISTS (
		SELECT 1 FROM `month_close_states`
		WHERE `status` = 'closed'
			AND `target_month` >= substr(coalesce(NEW.`archived_on`, OLD.`archived_on`), 1, 7)
	)
BEGIN
	SELECT RAISE(ABORT, 'closed months prevent this manual-item lifecycle change');
END;
