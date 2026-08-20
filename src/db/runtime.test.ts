import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabase } from "@/db/runtime";
import { createDatabaseBackup } from "@/server/database-backup";
import { resolveDataPaths } from "@/server/data-paths";

const temporaryDirectories: string[] = [];

function createTemporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "project-financial-freedom-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createTestPaths(root: string) {
  return resolveDataPaths({
    environment: {
      NODE_ENV: "test",
      PFF_DATA_DIR: join(root, "data"),
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    chmodSync(directory, 0o700);
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("initializeDatabase", () => {
  it("creates, migrates, secures, and reopens an isolated database", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const firstContext = await initializeDatabase({ paths });

    expect(firstContext.health).toMatchObject({
      status: "healthy",
      quickCheck: "ok",
      foreignKeys: true,
      journalMode: "wal",
      appliedMigrations: 16,
    });
    expect(statSync(paths.dataDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(paths.databasePath).mode & 0o777).toBe(0o600);
    for (const sidecar of [`${paths.databasePath}-wal`, `${paths.databasePath}-shm`]) {
      if (existsSync(sidecar)) {
        expect(statSync(sidecar).mode & 0o777).toBe(0o600);
      }
    }
    expect(firstContext.backupCreated).toBeNull();

    firstContext.raw
      .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
      .run();
    firstContext.raw.close();

    const secondContext = await initializeDatabase({ paths });
    const settings = secondContext.raw
      .prepare("SELECT base_currency FROM app_settings WHERE id = 1")
      .get() as { base_currency: string };

    expect(settings.base_currency).toBe("USD");
    expect(secondContext.backupCreated).toBeNull();
    secondContext.raw.close();
  });

  it("backs up and upgrades an existing Phase 1 database", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const phaseOneMigrations = join(root, "phase-one-migrations");
    const phaseOneMeta = join(phaseOneMigrations, "meta");
    const currentJournal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };

    mkdirSync(phaseOneMeta, { recursive: true });
    cpSync(
      join(process.cwd(), "drizzle", "0000_far_maelstrom.sql"),
      join(phaseOneMigrations, "0000_far_maelstrom.sql"),
    );
    writeFileSync(
      join(phaseOneMeta, "_journal.json"),
      `${JSON.stringify(
        {
          ...currentJournal,
          entries: currentJournal.entries.slice(0, 1),
        },
        null,
        2,
      )}\n`,
    );

    const phaseOneContext = await initializeDatabase({
      paths,
      migrationsFolder: phaseOneMigrations,
    });
    phaseOneContext.raw
      .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'EUR')")
      .run();
    phaseOneContext.raw.close();

    const upgradedContext = await initializeDatabase({ paths });
    const settings = upgradedContext.raw
      .prepare("SELECT base_currency FROM app_settings WHERE id = 1")
      .get() as { base_currency: string };
    const categories = upgradedContext.raw
      .prepare("SELECT count(*) AS count FROM categories")
      .get() as { count: number };

    expect(upgradedContext.backupCreated).not.toBeNull();
    expect(upgradedContext.health.appliedMigrations).toBe(16);
    expect(settings.base_currency).toBe("EUR");
    expect(categories.count).toBe(15);
    expect(
      readdirSync(paths.backupDirectory).filter(
        (file) => file.endsWith("-wal") || file.endsWith("-shm"),
      ),
    ).toEqual([]);
    upgradedContext.raw.close();
  });

  it("upgrades cleanly from every previously released migration boundary", async () => {
    const currentJournal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };

    for (let boundary = 1; boundary < currentJournal.entries.length; boundary += 1) {
      const root = createTemporaryRoot();
      const paths = createTestPaths(root);
      const priorMigrations = join(root, `migrations-through-${boundary}`);
      const priorMeta = join(priorMigrations, "meta");
      const priorEntries = currentJournal.entries.slice(0, boundary);
      mkdirSync(priorMeta, { recursive: true });
      for (const entry of priorEntries) {
        cpSync(
          join(process.cwd(), "drizzle", `${entry.tag}.sql`),
          join(priorMigrations, `${entry.tag}.sql`),
        );
      }
      writeFileSync(
        join(priorMeta, "_journal.json"),
        `${JSON.stringify({ ...currentJournal, entries: priorEntries }, null, 2)}\n`,
      );

      const prior = await initializeDatabase({
        paths,
        migrationsFolder: priorMigrations,
      });
      prior.raw
        .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
        .run();
      prior.raw.close();

      const upgraded = await initializeDatabase({ paths });
      expect(upgraded.health.appliedMigrations).toBe(currentJournal.entries.length);
      expect(upgraded.raw.pragma("foreign_key_check")).toEqual([]);
      expect(
        upgraded.raw
          .prepare("SELECT base_currency FROM app_settings WHERE id = 1")
          .get(),
      ).toEqual({ base_currency: "USD" });
      expect(upgraded.backupCreated).not.toBeNull();
      upgraded.raw.close();
    }
  });

  it("preserves Phase 4 decisions while aligning their physical checks", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const phaseFourMigrations = join(root, "phase-four-migrations");
    const phaseFourMeta = join(phaseFourMigrations, "meta");
    const currentJournal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    const phaseFourEntries = currentJournal.entries.slice(0, 10);

    mkdirSync(phaseFourMeta, { recursive: true });
    for (const entry of phaseFourEntries) {
      cpSync(
        join(process.cwd(), "drizzle", `${entry.tag}.sql`),
        join(phaseFourMigrations, `${entry.tag}.sql`),
      );
    }
    writeFileSync(
      join(phaseFourMeta, "_journal.json"),
      `${JSON.stringify({ ...currentJournal, entries: phaseFourEntries }, null, 2)}\n`,
    );

    const phaseFourContext = await initializeDatabase({
      paths,
      migrationsFolder: phaseFourMigrations,
    });
    expect(phaseFourContext.health.appliedMigrations).toBe(10);
    phaseFourContext.raw.exec(`
      INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD');
      INSERT INTO financial_accounts (
        name, type, currency, opening_date
      ) VALUES ('Checking', 'checking', 'USD', '2026-07-01');
      INSERT INTO categories (
        name, slug, kind
      ) VALUES ('Runtime expense', 'runtime-expense', 'expense');
      INSERT INTO import_batches (
        financial_account_id, source_filename, file_checksum, csv_schema_version,
        currency, statement_start_date, statement_end_date,
        opening_balance_minor, closing_balance_minor, row_count, warning_count,
        validation_status, review_status, is_sealed
      ) VALUES (
        1, 'phase-four.csv',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'csv-v1', 'USD', '2026-08-01', '2026-08-31',
        10000, 9000, 1, 0, 'validated', 'in_review', 0
      );
      INSERT INTO import_rows (
        import_batch_id, original_row_number, transaction_date, description,
        amount_minor, currency, default_effective_date, normalized_fingerprint,
        validation_status, review_status, warnings_json
      ) VALUES (
        1, 2, '2026-08-04', 'Groceries', -1000, 'USD', '2026-08-04',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'valid', 'unresolved', '[]'
      );
      UPDATE import_batches SET is_sealed = 1 WHERE id = 1;
      INSERT INTO import_row_decisions (
        import_row_id, disposition, confirmed_type, effective_date
      ) VALUES (1, 'accepted', 'expense', '2026-08-04');
      INSERT INTO import_row_category_allocations (
        import_row_decision_id, import_row_id, category_id, amount_minor
      ) VALUES (
        1, 1, (SELECT id FROM categories WHERE slug = 'runtime-expense'), 1000
      );
    `);
    phaseFourContext.raw.close();

    const upgradedContext = await initializeDatabase({ paths });
    const decisionTable = upgradedContext.raw
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'import_row_decisions'",
      )
      .get() as { sql: string };

    expect(upgradedContext.backupCreated).not.toBeNull();
    expect(upgradedContext.health.appliedMigrations).toBe(16);
    expect(decisionTable.sql).toContain('"exclusion_reason" IS NOT NULL');
    expect(decisionTable.sql).toContain(
      `strftime('%Y-%m-%d', "import_row_decisions"."effective_date", '+0 days') IS NOT NULL`,
    );
    expect(
      upgradedContext.raw
        .prepare(
          `SELECT decision.disposition, allocation.amount_minor
           FROM import_row_decisions AS decision
           INNER JOIN import_row_category_allocations AS allocation
             ON allocation.import_row_decision_id = decision.id`,
        )
        .get(),
    ).toEqual({ disposition: "accepted", amount_minor: 1000 });
    expect(upgradedContext.raw.pragma("foreign_key_check")).toEqual([]);
    upgradedContext.raw.close();
  });

  it("backfills posted external transfers into the outside-scope balance", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const priorMigrations = join(root, "prior-phase-five-migrations");
    const priorMeta = join(priorMigrations, "meta");
    const currentJournal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    const priorEntries = currentJournal.entries.slice(0, 13);

    mkdirSync(priorMeta, { recursive: true });
    for (const entry of priorEntries) {
      cpSync(
        join(process.cwd(), "drizzle", `${entry.tag}.sql`),
        join(priorMigrations, `${entry.tag}.sql`),
      );
    }
    writeFileSync(
      join(priorMeta, "_journal.json"),
      `${JSON.stringify({ ...currentJournal, entries: priorEntries }, null, 2)}\n`,
    );

    const priorContext = await initializeDatabase({
      paths,
      migrationsFolder: priorMigrations,
    });
    expect(priorContext.health.appliedMigrations).toBe(13);
    priorContext.raw.exec(`
      INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD');
      INSERT INTO financial_accounts (
        name, type, currency, opening_date
      ) VALUES ('Prior external checking', 'checking', 'USD', '2026-08-01');
      INSERT INTO ledger_accounts (
        name, kind, financial_account_id
      ) VALUES ('Prior external checking', 'asset', 1);
      INSERT INTO import_batches (
        financial_account_id, source_filename, file_checksum, csv_schema_version,
        currency, statement_start_date, statement_end_date,
        opening_balance_minor, closing_balance_minor, row_count, warning_count,
        validation_status, review_status, is_sealed, finalized_at, ledger_posted_at
      ) VALUES (
        1, 'prior-external.csv',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'csv-v1', 'USD', '2026-08-01', '2026-08-31',
        10000, 9000, 1, 0, 'validated', 'in_review', 0,
        NULL, NULL
      );
      INSERT INTO import_rows (
        import_batch_id, original_row_number, transaction_date, description,
        amount_minor, currency, default_effective_date, normalized_fingerprint,
        validation_status, review_status, warnings_json
      ) VALUES (
        1, 2, '2026-08-10', 'Transfer to owned brokerage', -1000, 'USD',
        '2026-08-10',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'valid', 'unresolved', '[]'
      );
      UPDATE import_batches SET is_sealed = 1 WHERE id = 1;
      INSERT INTO import_row_decisions (
        import_row_id, disposition, confirmed_type, effective_date
      ) VALUES (1, 'accepted', 'transfer', '2026-08-10');
      INSERT INTO journal_entries (
        effective_date, description, source_type
      ) VALUES ('2026-08-10', 'Transfer to owned brokerage', 'import');
      INSERT INTO import_row_journal_entries (
        import_row_id, journal_entry_id
      ) VALUES (1, 1);
      INSERT INTO postings (
        journal_entry_id, ledger_account_id, amount_minor
      ) VALUES
        (1, (SELECT id FROM ledger_accounts WHERE financial_account_id = 1), -1000),
        (1, (SELECT id FROM ledger_accounts WHERE system_key = 'transfer_clearing'), 1000);
      UPDATE journal_entries
      SET is_posted = 1, posted_at = CURRENT_TIMESTAMP
      WHERE id = 1;
      UPDATE import_batches
      SET review_status = 'finalized',
          finalized_at = CURRENT_TIMESTAMP,
          ledger_posted_at = CURRENT_TIMESTAMP
      WHERE id = 1;
      INSERT INTO import_transfer_resolutions (
        import_row_id, classification
      ) VALUES (1, 'external_out');
    `);
    priorContext.raw.close();

    const upgradedContext = await initializeDatabase({ paths });
    const resolution = upgradedContext.raw
      .prepare(
        `SELECT reclassification_journal_entry_id AS journalEntryId
         FROM import_transfer_resolutions WHERE import_row_id = 1`,
      )
      .get() as { journalEntryId: number };
    const balances = upgradedContext.raw
      .prepare(
        `SELECT ledger.system_key AS systemKey,
                coalesce(sum(posting.amount_minor), 0) AS amountMinor
         FROM ledger_accounts AS ledger
         LEFT JOIN postings AS posting ON posting.ledger_account_id = ledger.id
         WHERE ledger.system_key IN ('transfer_clearing', 'outside_scope_transfers')
         GROUP BY ledger.id
         ORDER BY ledger.system_key`,
      )
      .all();

    expect(upgradedContext.health.appliedMigrations).toBe(16);
    expect(resolution.journalEntryId).toBeGreaterThan(1);
    expect(balances).toEqual([
      { systemKey: "outside_scope_transfers", amountMinor: 1000 },
      { systemKey: "transfer_clearing", amountMinor: 0 },
    ]);
    expect(upgradedContext.raw.pragma("foreign_key_check")).toEqual([]);
    upgradedContext.raw.close();
  });

  it("deduplicates verified backups and removes verification sidecars", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const context = await initializeDatabase({ paths });

    context.raw
      .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
      .run();

    const first = await createDatabaseBackup(context.raw, paths, "pre-migration");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createDatabaseBackup(context.raw, paths, "pre-migration");
    const backupFiles = readdirSync(paths.backupDirectory);

    expect(second).toBe(first);
    expect(backupFiles.filter((file) => file.endsWith(".sqlite"))).toHaveLength(1);
    expect(
      backupFiles.filter((file) => file.endsWith("-wal") || file.endsWith("-shm")),
    ).toEqual([]);
    context.raw.close();
  });

  it("backs up and rolls back an existing database when a migration fails", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const initialContext = await initializeDatabase({ paths });

    initialContext.raw
      .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'COP')")
      .run();
    initialContext.raw.close();

    const failingMigrations = join(root, "failing-migrations");
    cpSync(join(process.cwd(), "drizzle"), failingMigrations, {
      recursive: true,
    });

    const journalPath = join(failingMigrations, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    const priorMigration = journal.entries.at(-1);

    if (!priorMigration) {
      throw new Error("The generated migration journal is empty.");
    }

    journal.entries.push({
      idx: priorMigration.idx + 1,
      version: priorMigration.version,
      when: priorMigration.when + 1,
      tag: "0001_failure_test",
      breakpoints: true,
    });
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    writeFileSync(
      join(failingMigrations, "0001_failure_test.sql"),
      [
        "CREATE TABLE should_rollback (id integer);",
        "--> statement-breakpoint",
        "THIS IS NOT VALID SQL;",
      ].join("\n"),
    );

    await expect(
      initializeDatabase({
        paths,
        migrationsFolder: failingMigrations,
      }),
    ).rejects.toThrow("Could not initialize the local financial database.");

    const backups = readdirSync(paths.backupDirectory).filter((file) =>
      file.endsWith(".sqlite"),
    );
    expect(backups).toHaveLength(1);

    const database = new Database(paths.databasePath, { readonly: true });
    const settings = database
      .prepare("SELECT base_currency FROM app_settings WHERE id = 1")
      .get() as { base_currency: string };
    const partialTable = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'",
      )
      .get();

    expect(settings.base_currency).toBe("COP");
    expect(partialTable).toBeUndefined();
    database.close();

    const backup = new Database(join(paths.backupDirectory, backups[0]!), {
      readonly: true,
    });
    const backedUpSettings = backup
      .prepare("SELECT base_currency FROM app_settings WHERE id = 1")
      .get() as { base_currency: string };

    expect(backedUpSettings.base_currency).toBe("COP");
    backup.close();
  });

  it("rejects an existing database with foreign-key violations", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const initialContext = await initializeDatabase({ paths });

    initialContext.raw.pragma("foreign_keys = OFF");
    const entry = initialContext.raw
      .prepare(
        `INSERT INTO journal_entries (effective_date, description, source_type)
         VALUES ('2026-08-01', 'Broken legacy row', 'manual')`,
      )
      .run();
    initialContext.raw
      .prepare(
        `INSERT INTO postings (journal_entry_id, ledger_account_id, amount_minor)
         VALUES (?, 999999, 100)`,
      )
      .run(Number(entry.lastInsertRowid));
    initialContext.raw.close();

    await expect(initializeDatabase({ paths })).rejects.toThrow(
      "Could not initialize the local financial database.",
    );
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
  });

  it("rejects a database created by a newer migration journal", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);
    const initialContext = await initializeDatabase({ paths });

    initialContext.raw
      .prepare(
        `UPDATE __drizzle_migrations
         SET created_at = created_at + 999999999999
         WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)`,
      )
      .run();
    initialContext.raw.close();

    await expect(initializeDatabase({ paths })).rejects.toThrow(
      "Could not initialize the local financial database.",
    );
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
  });

  it("stops before backup when an existing database is corrupt", async () => {
    const root = createTemporaryRoot();
    const paths = createTestPaths(root);

    mkdirSync(paths.dataDirectory, { recursive: true });
    writeFileSync(paths.databasePath, "not a sqlite database");

    await expect(initializeDatabase({ paths })).rejects.toThrow(
      "Could not initialize the local financial database.",
    );
    expect(readdirSync(paths.backupDirectory)).toHaveLength(0);
  });
});
