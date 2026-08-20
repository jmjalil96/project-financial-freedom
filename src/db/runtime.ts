import { chmodSync, closeSync, existsSync, openSync, statSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getAppliedMigrationCount, hasPendingMigrations } from "@/db/migration-state";
import { ensureLedgerFoundation } from "@/db/seed";
import * as schema from "@/db/schema";
import {
  createDatabaseBackup,
  ensureDailyDatabaseBackup,
} from "@/server/database-backup";
import { ensureDataDirectories, type DataPaths } from "@/server/data-paths";

export type DatabaseHealth = {
  status: "healthy";
  quickCheck: "ok";
  foreignKeys: true;
  foreignKeyCheck: "ok";
  journalMode: "wal";
  appliedMigrations: number;
};

export type DatabaseContext = {
  raw: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  paths: DataPaths;
  health: DatabaseHealth;
  backupCreated: string | null;
  dailyBackupCreated: string | null;
};

type InitializeDatabaseOptions = {
  paths: DataPaths;
  migrationsFolder?: string;
};

function configureDatabase(database: Database.Database): void {
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("busy_timeout = 5000");
}

function secureDatabaseFiles(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(/* turbopackIgnore: true */ path)) {
      chmodSync(path, 0o600);
    }
  }
}

export function inspectDatabaseHealth(database: Database.Database): DatabaseHealth {
  const quickCheck = database.pragma("quick_check", {
    simple: true,
  });
  const foreignKeys = database.pragma("foreign_keys", {
    simple: true,
  });
  const journalMode = database.pragma("journal_mode", {
    simple: true,
  });
  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];

  if (quickCheck !== "ok") {
    throw new Error(`Database integrity check failed: ${String(quickCheck)}`);
  }

  if (Number(foreignKeys) !== 1) {
    throw new Error("Database foreign-key enforcement is disabled.");
  }

  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `Database foreign-key check found ${foreignKeyViolations.length} violation(s).`,
    );
  }

  if (String(journalMode).toLowerCase() !== "wal") {
    throw new Error("Database journal mode is not WAL.");
  }

  return {
    status: "healthy",
    quickCheck: "ok",
    foreignKeys: true,
    foreignKeyCheck: "ok",
    journalMode: "wal",
    appliedMigrations: getAppliedMigrationCount(database),
  };
}

export async function initializeDatabase({
  paths,
  migrationsFolder = join(process.cwd(), "drizzle"),
}: InitializeDatabaseOptions): Promise<DatabaseContext> {
  process.umask(process.umask() | 0o077);
  ensureDataDirectories(paths);

  const databaseExisted =
    existsSync(paths.databasePath) && statSync(paths.databasePath).size > 0;
  const databaseFile = openSync(paths.databasePath, "a", 0o600);
  closeSync(databaseFile);
  chmodSync(paths.databasePath, 0o600);
  const raw = new Database(paths.databasePath);

  try {
    configureDatabase(raw);
    inspectDatabaseHealth(raw);

    const db = drizzle(raw, { schema });
    const pendingMigrations = hasPendingMigrations(raw, migrationsFolder);
    const backupCreated =
      databaseExisted && pendingMigrations
        ? await createDatabaseBackup(raw, paths, "pre-migration")
        : null;

    migrate(db, { migrationsFolder });
    const hasLedgerAccountsTable = raw
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ledger_accounts'",
      )
      .get();

    if (hasLedgerAccountsTable) {
      ensureLedgerFoundation(db);
    }
    secureDatabaseFiles(paths.databasePath);
    const dailyBackupCreated = databaseExisted
      ? await ensureDailyDatabaseBackup(raw, paths)
      : null;

    return {
      raw,
      db,
      paths,
      health: inspectDatabaseHealth(raw),
      backupCreated,
      dailyBackupCreated,
    };
  } catch (error) {
    raw.close();
    throw new Error("Could not initialize the local financial database.", {
      cause: error,
    });
  }
}
