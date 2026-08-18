import { createHash } from "node:crypto";
import { chmodSync, createReadStream, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

import type { DataPaths } from "@/server/data-paths";

export type BackupReason = "pre-migration";

const retainedBackupsPerReason = 5;

function removeDatabaseFiles(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

async function computeChecksum(path: string): Promise<string> {
  const checksum = createHash("sha256");

  for await (const chunk of createReadStream(path)) {
    checksum.update(chunk);
  }

  return checksum.digest("hex");
}

function listBackups(paths: DataPaths, reason: BackupReason): string[] {
  return readdirSync(paths.backupDirectory)
    .filter(
      (filename) => filename.startsWith(`${reason}-`) && filename.endsWith(".sqlite"),
    )
    .map((filename) => join(paths.backupDirectory, filename))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function pruneBackups(paths: DataPaths, reason: BackupReason): void {
  for (const path of listBackups(paths, reason).slice(retainedBackupsPerReason)) {
    removeDatabaseFiles(path);
  }
}

export async function createDatabaseBackup(
  database: Database.Database,
  paths: DataPaths,
  reason: BackupReason,
): Promise<string> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const destination = join(paths.backupDirectory, `${reason}-${timestamp}.sqlite`);

  await database.backup(destination);
  chmodSync(destination, 0o600);

  const backup = new Database(destination, { readonly: true });

  try {
    const quickCheck = backup.pragma("quick_check", { simple: true });
    const foreignKeyViolations = backup.pragma("foreign_key_check") as unknown[];

    if (quickCheck !== "ok" || foreignKeyViolations.length > 0) {
      throw new Error("The pre-migration database backup failed verification.");
    }

    backup.close();
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });

    const destinationChecksum = await computeChecksum(destination);
    const priorBackups = listBackups(paths, reason).filter(
      (path) => path !== destination,
    );

    for (const priorBackup of priorBackups) {
      if ((await computeChecksum(priorBackup)) === destinationChecksum) {
        removeDatabaseFiles(destination);
        pruneBackups(paths, reason);
        return priorBackup;
      }
    }

    pruneBackups(paths, reason);
    return destination;
  } catch (error) {
    removeDatabaseFiles(destination);
    throw error;
  } finally {
    if (backup.open) {
      backup.close();
    }
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
  }
}
