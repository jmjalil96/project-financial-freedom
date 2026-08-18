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
      appliedMigrations: 8,
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
    expect(upgradedContext.health.appliedMigrations).toBe(8);
    expect(settings.base_currency).toBe("EUR");
    expect(categories.count).toBe(15);
    expect(
      readdirSync(paths.backupDirectory).filter(
        (file) => file.endsWith("-wal") || file.endsWith("-shm"),
      ),
    ).toEqual([]);
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
