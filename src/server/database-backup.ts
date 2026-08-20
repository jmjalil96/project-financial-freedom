import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { basename, join } from "node:path";

import Database from "better-sqlite3";

import type { DataPaths } from "@/server/data-paths";

export const backupReasons = [
  "pre-migration",
  "daily",
  "pre-reopen",
  "pre-correction",
  "pre-restore",
  "manual",
] as const;

export type BackupReason = (typeof backupReasons)[number];

export type DatabaseBackupSummary = {
  filename: string;
  reason: BackupReason;
  createdAt: string;
  sizeBytes: number;
};

const recentBackupLimit = 14;
const monthlyBackupLimit = 12;

function removeDatabaseFiles(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

export async function computeFileChecksum(path: string): Promise<string> {
  const checksum = createHash("sha256");

  for await (const chunk of createReadStream(path)) {
    checksum.update(chunk);
  }

  return checksum.digest("hex");
}

function reasonFromFilename(filename: string): BackupReason | null {
  return (
    [...backupReasons]
      .sort((left, right) => right.length - left.length)
      .find((reason) => filename.startsWith(`${reason}-`)) ?? null
  );
}

export function listDatabaseBackups(paths: DataPaths): DatabaseBackupSummary[] {
  return readdirSync(paths.backupDirectory)
    .flatMap((filename): DatabaseBackupSummary[] => {
      if (!filename.endsWith(".sqlite")) {
        return [];
      }
      const reason = reasonFromFilename(filename);
      if (!reason) {
        return [];
      }
      const stats = statSync(join(paths.backupDirectory, filename));
      if (!stats.isFile()) {
        return [];
      }
      return [
        {
          filename,
          reason,
          createdAt: stats.mtime.toISOString(),
          sizeBytes: stats.size,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.filename.localeCompare(left.filename),
    );
}

export function resolveBackupPath(paths: DataPaths, filename: string): string {
  if (
    basename(filename) !== filename ||
    !filename.endsWith(".sqlite") ||
    !reasonFromFilename(filename)
  ) {
    throw new Error("Choose a recognized Project Financial Freedom backup.");
  }
  const path = join(paths.backupDirectory, filename);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error("The selected backup is no longer available.");
  }
  return path;
}

export function verifySqliteDatabaseFile(path: string): void {
  const database = new Database(path, { readonly: true });
  try {
    database.pragma("foreign_keys = ON");
    const quickCheck = database.pragma("quick_check", { simple: true });
    const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];
    if (quickCheck !== "ok" || foreignKeyViolations.length > 0) {
      throw new Error("The database snapshot failed its integrity checks.");
    }
  } finally {
    database.close();
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
}

export function pruneDatabaseBackups(paths: DataPaths): void {
  const backups = listDatabaseBackups(paths);
  const retained = new Set(
    backups.slice(0, recentBackupLimit).map((backup) => backup.filename),
  );
  const retainedMonths = new Set<string>();

  for (const backup of backups) {
    const month = backup.createdAt.slice(0, 7);
    if (retainedMonths.has(month)) {
      continue;
    }
    if (retainedMonths.size >= monthlyBackupLimit) {
      break;
    }
    retainedMonths.add(month);
    retained.add(backup.filename);
  }

  for (const backup of backups) {
    if (!retained.has(backup.filename)) {
      removeDatabaseFiles(join(paths.backupDirectory, backup.filename));
    }
  }
}

export async function createDatabaseBackup(
  database: Database.Database,
  paths: DataPaths,
  reason: BackupReason,
  now = new Date(),
): Promise<string> {
  const timestamp = now.toISOString().replaceAll(":", "-");
  const baseName = `${reason}-${timestamp}`;
  let destination = join(paths.backupDirectory, `${baseName}.sqlite`);
  let suffix = 1;
  while (existsSync(destination)) {
    destination = join(paths.backupDirectory, `${baseName}-${suffix}.sqlite`);
    suffix += 1;
  }

  try {
    await database.backup(destination);
    chmodSync(destination, 0o600);
    utimesSync(destination, now, now);
    verifySqliteDatabaseFile(destination);
    const destinationChecksum = await computeFileChecksum(destination);
    const priorBackups = listDatabaseBackups(paths).filter(
      (backup) => backup.reason === reason && backup.filename !== basename(destination),
    );

    for (const priorBackup of priorBackups) {
      const priorPath = join(paths.backupDirectory, priorBackup.filename);
      if ((await computeFileChecksum(priorPath)) === destinationChecksum) {
        removeDatabaseFiles(destination);
        pruneDatabaseBackups(paths);
        return priorPath;
      }
    }

    pruneDatabaseBackups(paths);
    return destination;
  } catch (error) {
    removeDatabaseFiles(destination);
    throw error;
  } finally {
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
  }
}

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function ensureDailyDatabaseBackup(
  database: Database.Database,
  paths: DataPaths,
  now = new Date(),
): Promise<string | null> {
  const today = localDate(now);
  const existing = listDatabaseBackups(paths).find(
    (backup) =>
      backup.reason === "daily" && localDate(new Date(backup.createdAt)) === today,
  );
  return existing ? null : createDatabaseBackup(database, paths, "daily", now);
}
