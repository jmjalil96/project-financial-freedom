CREATE TEMP TABLE `_pff_review_decisions_backup` AS
SELECT * FROM `import_row_decisions`;--> statement-breakpoint
CREATE TEMP TABLE `_pff_review_allocations_backup` AS
SELECT * FROM `import_row_category_allocations`;--> statement-breakpoint
DROP TABLE `import_row_category_allocations`;--> statement-breakpoint
DROP TABLE `import_row_decisions`;--> statement-breakpoint
CREATE TABLE `import_row_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_row_id` integer NOT NULL,
	`disposition` text NOT NULL,
	`confirmed_type` text,
	`effective_date` text,
	`normalized_merchant` text,
	`review_note` text,
	`exclusion_reason` text,
	`duplicate_of_import_row_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`duplicate_of_import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_row_decisions_disposition" CHECK("import_row_decisions"."disposition" IN ('accepted', 'excluded', 'duplicate')),
	CONSTRAINT "import_row_decisions_confirmed_type" CHECK("import_row_decisions"."confirmed_type" IS NULL OR "import_row_decisions"."confirmed_type" IN ('income', 'expense', 'transfer', 'refund', 'adjustment')),
	CONSTRAINT "import_row_decisions_effective_date" CHECK("import_row_decisions"."effective_date" IS NULL OR (
		"import_row_decisions"."effective_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
		AND strftime('%Y-%m-%d', "import_row_decisions"."effective_date", '+0 days') IS NOT NULL
		AND strftime('%Y-%m-%d', "import_row_decisions"."effective_date", '+0 days') = "import_row_decisions"."effective_date"
	)),
	CONSTRAINT "import_row_decisions_duplicate_not_self" CHECK("import_row_decisions"."duplicate_of_import_row_id" IS NULL OR "import_row_decisions"."duplicate_of_import_row_id" != "import_row_decisions"."import_row_id"),
	CONSTRAINT "import_row_decisions_disposition_details" CHECK((
		"import_row_decisions"."disposition" = 'accepted'
		AND "import_row_decisions"."exclusion_reason" IS NULL
		AND "import_row_decisions"."duplicate_of_import_row_id" IS NULL
	) OR (
		"import_row_decisions"."disposition" = 'excluded'
		AND "import_row_decisions"."exclusion_reason" IS NOT NULL
		AND length(trim("import_row_decisions"."exclusion_reason")) > 0
		AND "import_row_decisions"."duplicate_of_import_row_id" IS NULL
	) OR (
		"import_row_decisions"."disposition" = 'duplicate'
		AND "import_row_decisions"."exclusion_reason" IS NULL
		AND "import_row_decisions"."duplicate_of_import_row_id" IS NOT NULL
	))
);--> statement-breakpoint
INSERT INTO `import_row_decisions` (
	`id`, `import_row_id`, `disposition`, `confirmed_type`, `effective_date`,
	`normalized_merchant`, `review_note`, `exclusion_reason`,
	`duplicate_of_import_row_id`, `created_at`, `updated_at`
)
SELECT
	`id`, `import_row_id`, `disposition`, `confirmed_type`, `effective_date`,
	`normalized_merchant`, `review_note`, `exclusion_reason`,
	`duplicate_of_import_row_id`, `created_at`, `updated_at`
FROM `_pff_review_decisions_backup`;--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_decisions_import_row_unique`
ON `import_row_decisions` (`import_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_decisions_id_row_unique`
ON `import_row_decisions` (`id`, `import_row_id`);--> statement-breakpoint
CREATE INDEX `import_row_decisions_disposition_index`
ON `import_row_decisions` (`disposition`);--> statement-breakpoint
CREATE INDEX `import_row_decisions_duplicate_of_index`
ON `import_row_decisions` (`duplicate_of_import_row_id`);--> statement-breakpoint
CREATE TABLE `import_row_category_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_row_decision_id` integer NOT NULL,
	`import_row_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`import_row_decision_id`, `import_row_id`) REFERENCES `import_row_decisions`(`id`, `import_row_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_row_category_allocations_positive_amount" CHECK("import_row_category_allocations"."amount_minor" > 0)
);--> statement-breakpoint
INSERT INTO `import_row_category_allocations` (
	`id`, `import_row_decision_id`, `import_row_id`, `category_id`,
	`amount_minor`, `created_at`, `updated_at`
)
SELECT
	`id`, `import_row_decision_id`, `import_row_id`, `category_id`,
	`amount_minor`, `created_at`, `updated_at`
FROM `_pff_review_allocations_backup`;--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_category_allocations_row_category_unique`
ON `import_row_category_allocations` (`import_row_id`, `category_id`);--> statement-breakpoint
CREATE INDEX `import_row_category_allocations_decision_index`
ON `import_row_category_allocations` (`import_row_decision_id`);--> statement-breakpoint
CREATE INDEX `import_row_category_allocations_category_index`
ON `import_row_category_allocations` (`category_id`);--> statement-breakpoint
DROP TABLE `_pff_review_allocations_backup`;--> statement-breakpoint
DROP TABLE `_pff_review_decisions_backup`;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_prevent_finalized_insert`
BEFORE INSERT ON `import_row_decisions`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` = NEW.`import_row_id`
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch decisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_prevent_finalized_update`
BEFORE UPDATE ON `import_row_decisions`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` IN (OLD.`import_row_id`, NEW.`import_row_id`)
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch decisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_decisions_prevent_finalized_delete`
BEFORE DELETE ON `import_row_decisions`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` = OLD.`import_row_id`
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch decisions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_category_allocations_prevent_finalized_insert`
BEFORE INSERT ON `import_row_category_allocations`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` = NEW.`import_row_id`
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch category allocations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_category_allocations_prevent_finalized_update`
BEFORE UPDATE ON `import_row_category_allocations`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` IN (OLD.`import_row_id`, NEW.`import_row_id`)
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch category allocations are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `import_row_category_allocations_prevent_finalized_delete`
BEFORE DELETE ON `import_row_category_allocations`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` = OLD.`import_row_id`
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch category allocations are immutable');
END;--> statement-breakpoint
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