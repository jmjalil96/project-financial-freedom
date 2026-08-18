import { readFileSync } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";

type MigrationJournal = {
  entries: Array<{
    when: number;
  }>;
};

function getLatestAvailableMigration(migrationsFolder: string): number | null {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;

  return (
    journal.entries.reduce<number | null>(
      (latest, entry) => (latest === null || entry.when > latest ? entry.when : latest),
      null,
    ) ?? null
  );
}

function getLatestAppliedMigration(database: Database.Database): number | null {
  const migrationTable = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get("__drizzle_migrations");

  if (!migrationTable) {
    return null;
  }

  const result = database
    .prepare(
      "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { created_at?: number | string } | undefined;

  if (result?.created_at === undefined) {
    return null;
  }

  return Number(result.created_at);
}

export function hasPendingMigrations(
  database: Database.Database,
  migrationsFolder: string,
): boolean {
  const latestAvailable = getLatestAvailableMigration(migrationsFolder);
  const latestApplied = getLatestAppliedMigration(database);

  if (
    latestApplied !== null &&
    (latestAvailable === null || latestApplied > latestAvailable)
  ) {
    throw new Error(
      "This database was created by a newer version of Project Financial Freedom. Upgrade the app before opening it.",
    );
  }

  if (latestAvailable === null) {
    return false;
  }

  return latestApplied === null || latestAvailable > latestApplied;
}

export function getAppliedMigrationCount(database: Database.Database): number {
  const migrationTable = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get("__drizzle_migrations");

  if (!migrationTable) {
    return 0;
  }

  const result = database
    .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
    .get() as { count: number };

  return result.count;
}
