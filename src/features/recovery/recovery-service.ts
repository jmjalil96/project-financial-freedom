import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

import Database from "better-sqlite3";

import {
  closeDatabaseContext,
  getDatabaseContext,
  reinitializeDatabaseContext,
} from "@/db/client";
import { getAppliedMigrationCount } from "@/db/migration-state";
import { DomainError } from "@/domain/errors";
import { recordAuditEvent } from "@/features/audit/audit-service";
import {
  computeFileChecksum,
  createDatabaseBackup,
  listDatabaseBackups,
  resolveBackupPath,
  verifySqliteDatabaseFile,
  type DatabaseBackupSummary,
} from "@/server/database-backup";
import type { DataPaths } from "@/server/data-paths";

export type BackupRestorePreview = DatabaseBackupSummary & {
  checksum: string;
  baseCurrency: string | null;
  appliedMigrations: number;
  requiresMigration: boolean;
  counts: {
    accounts: number;
    imports: number;
    journalEntries: number;
    manualItems: number;
    closeRevisions: number;
  };
};

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName),
  );
}

function tableCount(database: Database.Database, tableName: string): number {
  if (!tableExists(database, tableName)) {
    return 0;
  }
  const result = database
    .prepare(`SELECT count(*) AS count FROM "${tableName}"`)
    .get() as { count: number };
  return result.count;
}

async function inspectBackupPath(input: {
  path: string;
  summary: DatabaseBackupSummary;
  supportedMigrationCount: number;
}): Promise<BackupRestorePreview> {
  verifySqliteDatabaseFile(input.path);
  const database = new Database(input.path, { readonly: true });
  try {
    const appliedMigrations = getAppliedMigrationCount(database);
    if (appliedMigrations > input.supportedMigrationCount) {
      throw new DomainError(
        "This backup was created by a newer app version. Upgrade the app before restoring it.",
      );
    }
    const settings = tableExists(database, "app_settings")
      ? (database
          .prepare("SELECT base_currency AS baseCurrency FROM app_settings LIMIT 1")
          .get() as { baseCurrency: string } | undefined)
      : undefined;
    return {
      ...input.summary,
      checksum: await computeFileChecksum(input.path),
      baseCurrency: settings?.baseCurrency ?? null,
      appliedMigrations,
      requiresMigration: appliedMigrations < input.supportedMigrationCount,
      counts: {
        accounts: tableCount(database, "financial_accounts"),
        imports: tableCount(database, "import_batches"),
        journalEntries: tableCount(database, "journal_entries"),
        manualItems: tableCount(database, "manual_items"),
        closeRevisions: tableCount(database, "month_close_revisions"),
      },
    };
  } finally {
    database.close();
    rmSync(`${input.path}-wal`, { force: true });
    rmSync(`${input.path}-shm`, { force: true });
  }
}

export async function getRecoveryWorkspace(): Promise<{
  backupDirectory: string;
  backups: DatabaseBackupSummary[];
}> {
  const { paths } = await getDatabaseContext();
  return {
    backupDirectory: paths.backupDirectory,
    backups: listDatabaseBackups(paths),
  };
}

export async function getBackupRestorePreview(
  filename: string,
): Promise<BackupRestorePreview> {
  const context = await getDatabaseContext();
  const summary = listDatabaseBackups(context.paths).find(
    (backup) => backup.filename === filename,
  );
  if (!summary) {
    throw new DomainError("The selected backup is no longer available.");
  }
  return inspectBackupPath({
    path: resolveBackupPath(context.paths, filename),
    summary,
    supportedMigrationCount: context.health.appliedMigrations,
  });
}

export async function createManualDatabaseBackup(): Promise<DatabaseBackupSummary> {
  const context = await getDatabaseContext();
  const path = await createDatabaseBackup(context.raw, context.paths, "manual");
  context.db.transaction((transaction) => {
    recordAuditEvent(transaction, {
      action: "database.manual_backup_created",
      entityType: "database",
      entityId: 1,
      details: { filename: basename(path) },
    });
  });
  const summary = listDatabaseBackups(context.paths).find(
    (backup) => backup.filename === basename(path),
  );
  if (!summary) {
    throw new Error("The verified manual backup could not be listed.");
  }
  return summary;
}

function removeLiveDatabaseFiles(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

async function stageBackup(sourcePath: string, paths: DataPaths): Promise<string> {
  const stagedPath = join(paths.dataDirectory, `.restore-stage-${randomUUID()}.sqlite`);
  const source = new Database(sourcePath, { readonly: true });
  try {
    await source.backup(stagedPath);
    chmodSync(stagedPath, 0o600);
    verifySqliteDatabaseFile(stagedPath);
    return stagedPath;
  } catch (error) {
    removeLiveDatabaseFiles(stagedPath);
    throw error;
  } finally {
    source.close();
  }
}

export async function restoreDatabaseBackup(filename: string): Promise<{
  filename: string;
  safetyBackupFilename: string;
}> {
  const context = await getDatabaseContext();
  const sourcePath = resolveBackupPath(context.paths, filename);
  await getBackupRestorePreview(filename);
  const stagedPath = await stageBackup(sourcePath, context.paths);
  const rollbackPath = join(
    context.paths.dataDirectory,
    `.restore-rollback-${randomUUID()}.sqlite`,
  );
  let liveWasMoved = false;

  try {
    const safetyBackup = await createDatabaseBackup(
      context.raw,
      context.paths,
      "pre-restore",
    );
    context.raw.pragma("wal_checkpoint(TRUNCATE)");
    await closeDatabaseContext();
    renameSync(context.paths.databasePath, rollbackPath);
    liveWasMoved = true;
    rmSync(`${context.paths.databasePath}-wal`, { force: true });
    rmSync(`${context.paths.databasePath}-shm`, { force: true });
    renameSync(stagedPath, context.paths.databasePath);
    chmodSync(context.paths.databasePath, 0o600);

    const restored = await reinitializeDatabaseContext(context.paths);
    restored.db.transaction((transaction) => {
      recordAuditEvent(transaction, {
        action: "database.restored",
        entityType: "database",
        entityId: 1,
        details: {
          filename,
          safetyBackupFilename: basename(safetyBackup),
        },
      });
    });
    rmSync(rollbackPath, { force: true });
    return {
      filename,
      safetyBackupFilename: basename(safetyBackup),
    };
  } catch (restoreError) {
    if (liveWasMoved && existsSync(rollbackPath)) {
      try {
        await closeDatabaseContext();
        removeLiveDatabaseFiles(context.paths.databasePath);
        renameSync(rollbackPath, context.paths.databasePath);
        chmodSync(context.paths.databasePath, 0o600);
        await reinitializeDatabaseContext(context.paths);
      } catch (rollbackError) {
        const recoveryLocation = existsSync(rollbackPath)
          ? rollbackPath
          : context.paths.databasePath;
        throw new Error(
          `The restore and automatic rollback both failed. Preserve the recovery database at ${recoveryLocation}.`,
          { cause: new AggregateError([restoreError, rollbackError]) },
        );
      }
    }
    throw new DomainError(
      "The restore did not complete. The original live database remains active.",
    );
  } finally {
    rmSync(stagedPath, { force: true });
  }
}
