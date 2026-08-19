CREATE TABLE `import_duplicate_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_row_id` integer NOT NULL,
	`candidate_import_row_id` integer NOT NULL,
	`match_kind` text NOT NULL,
	`strength` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`candidate_import_row_id`) REFERENCES `import_rows`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_duplicate_candidates_match_kind" CHECK("import_duplicate_candidates"."match_kind" IN ('external_id', 'signature', 'statement_overlap')),
	CONSTRAINT "import_duplicate_candidates_strength" CHECK("import_duplicate_candidates"."strength" IN ('strong', 'weak')),
	CONSTRAINT "import_duplicate_candidates_status" CHECK("import_duplicate_candidates"."status" IN ('open', 'dismissed', 'confirmed')),
	CONSTRAINT "import_duplicate_candidates_not_self" CHECK("import_duplicate_candidates"."import_row_id" != "import_duplicate_candidates"."candidate_import_row_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_duplicate_candidates_pair_unique` ON `import_duplicate_candidates` (`import_row_id`,`candidate_import_row_id`);--> statement-breakpoint
CREATE INDEX `import_duplicate_candidates_row_status_index` ON `import_duplicate_candidates` (`import_row_id`,`status`);--> statement-breakpoint
CREATE INDEX `import_duplicate_candidates_candidate_row_index` ON `import_duplicate_candidates` (`candidate_import_row_id`);--> statement-breakpoint
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
	FOREIGN KEY (`import_row_decision_id`,`import_row_id`) REFERENCES `import_row_decisions`(`id`,`import_row_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_row_category_allocations_positive_amount" CHECK("import_row_category_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_category_allocations_row_category_unique` ON `import_row_category_allocations` (`import_row_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `import_row_category_allocations_decision_index` ON `import_row_category_allocations` (`import_row_decision_id`);--> statement-breakpoint
CREATE INDEX `import_row_category_allocations_category_index` ON `import_row_category_allocations` (`category_id`);--> statement-breakpoint
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
        AND strftime('%Y-%m-%d', "import_row_decisions"."effective_date", '+0 days') = "import_row_decisions"."effective_date"
      )),
	CONSTRAINT "import_row_decisions_duplicate_not_self" CHECK("import_row_decisions"."duplicate_of_import_row_id" IS NULL OR "import_row_decisions"."duplicate_of_import_row_id" != "import_row_decisions"."import_row_id"),
	CONSTRAINT "import_row_decisions_disposition_details" CHECK((
        "import_row_decisions"."disposition" = 'accepted'
        AND "import_row_decisions"."exclusion_reason" IS NULL
        AND "import_row_decisions"."duplicate_of_import_row_id" IS NULL
      ) OR (
        "import_row_decisions"."disposition" = 'excluded'
        AND length(trim("import_row_decisions"."exclusion_reason")) > 0
        AND "import_row_decisions"."duplicate_of_import_row_id" IS NULL
      ) OR (
        "import_row_decisions"."disposition" = 'duplicate'
        AND "import_row_decisions"."exclusion_reason" IS NULL
        AND "import_row_decisions"."duplicate_of_import_row_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_decisions_import_row_unique` ON `import_row_decisions` (`import_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_decisions_id_row_unique` ON `import_row_decisions` (`id`,`import_row_id`);--> statement-breakpoint
CREATE INDEX `import_row_decisions_disposition_index` ON `import_row_decisions` (`disposition`);--> statement-breakpoint
CREATE INDEX `import_row_decisions_duplicate_of_index` ON `import_row_decisions` (`duplicate_of_import_row_id`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `finalized_at` text;--> statement-breakpoint
UPDATE `import_batches`
SET `finalized_at` = CURRENT_TIMESTAMP
WHERE `review_status` = 'finalized';--> statement-breakpoint
CREATE TRIGGER `import_batches_require_finalized_timestamp_on_insert`
BEFORE INSERT ON `import_batches`
WHEN (
	NEW.`review_status` = 'finalized'
	AND NEW.`finalized_at` IS NULL
) OR (
	NEW.`review_status` != 'finalized'
	AND NEW.`finalized_at` IS NOT NULL
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch status and timestamp must agree');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_require_finalized_timestamp_on_update`
BEFORE UPDATE OF `review_status`, `finalized_at` ON `import_batches`
WHEN (
	NEW.`review_status` = 'finalized'
	AND NEW.`finalized_at` IS NULL
) OR (
	NEW.`review_status` != 'finalized'
	AND NEW.`finalized_at` IS NOT NULL
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch status and timestamp must agree');
END;
--> statement-breakpoint
CREATE TRIGGER `import_batches_prevent_finalization_reversal`
BEFORE UPDATE OF `review_status`, `finalized_at` ON `import_batches`
WHEN OLD.`review_status` = 'finalized'
	AND (
		NEW.`review_status` != 'finalized'
		OR NEW.`finalized_at` IS NOT OLD.`finalized_at`
	)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batches cannot be reopened or retimestamped');
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
CREATE TRIGGER `import_duplicate_candidates_prevent_finalized_insert`
BEFORE INSERT ON `import_duplicate_candidates`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` = NEW.`import_row_id`
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch duplicate candidates are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_duplicate_candidates_prevent_finalized_update`
BEFORE UPDATE ON `import_duplicate_candidates`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` IN (OLD.`import_row_id`, NEW.`import_row_id`)
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch duplicate candidates are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `import_duplicate_candidates_prevent_finalized_delete`
BEFORE DELETE ON `import_duplicate_candidates`
WHEN EXISTS (
	SELECT 1
	FROM `import_rows`
	INNER JOIN `import_batches`
		ON `import_batches`.`id` = `import_rows`.`import_batch_id`
	WHERE `import_rows`.`id` = OLD.`import_row_id`
		AND `import_batches`.`review_status` = 'finalized'
)
BEGIN
	SELECT RAISE(ABORT, 'finalized import batch duplicate candidates are immutable');
END;