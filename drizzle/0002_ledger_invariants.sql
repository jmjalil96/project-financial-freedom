CREATE TRIGGER `journal_entries_must_begin_as_draft`
BEFORE INSERT ON `journal_entries`
WHEN NEW.`is_posted` = 1
BEGIN
	SELECT RAISE(ABORT, 'journal entries must begin as drafts');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entries_require_balance_before_posting`
BEFORE UPDATE OF `is_posted` ON `journal_entries`
WHEN OLD.`is_posted` = 0 AND NEW.`is_posted` = 1
BEGIN
	SELECT CASE
		WHEN (SELECT count(*) FROM `postings` WHERE `journal_entry_id` = NEW.`id`) < 2
			THEN RAISE(ABORT, 'posted journal entries require at least two postings')
		WHEN (SELECT coalesce(sum(`amount_minor`), 0) FROM `postings` WHERE `journal_entry_id` = NEW.`id`) != 0
			THEN RAISE(ABORT, 'posted journal entries must balance to zero')
	END;
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entries_prevent_posted_updates`
BEFORE UPDATE ON `journal_entries`
WHEN OLD.`is_posted` = 1
BEGIN
	SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entries_prevent_posted_deletes`
BEFORE DELETE ON `journal_entries`
WHEN OLD.`is_posted` = 1
BEGIN
	SELECT RAISE(ABORT, 'posted journal entries cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `postings_prevent_insert_into_posted_entry`
BEFORE INSERT ON `postings`
WHEN (SELECT `is_posted` FROM `journal_entries` WHERE `id` = NEW.`journal_entry_id`) = 1
BEGIN
	SELECT RAISE(ABORT, 'postings for posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `postings_prevent_posted_updates`
BEFORE UPDATE ON `postings`
WHEN
	(SELECT `is_posted` FROM `journal_entries` WHERE `id` = OLD.`journal_entry_id`) = 1
	OR (SELECT `is_posted` FROM `journal_entries` WHERE `id` = NEW.`journal_entry_id`) = 1
BEGIN
	SELECT RAISE(ABORT, 'postings for posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `postings_prevent_posted_deletes`
BEFORE DELETE ON `postings`
WHEN (SELECT `is_posted` FROM `journal_entries` WHERE `id` = OLD.`journal_entry_id`) = 1
BEGIN
	SELECT RAISE(ABORT, 'postings for posted journal entries cannot be deleted');
END;