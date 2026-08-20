import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabase } from "@/db/runtime";
import {
  createDatabaseBackup,
  ensureDailyDatabaseBackup,
  listDatabaseBackups,
} from "@/server/database-backup";
import { resolveDataPaths } from "@/server/data-paths";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    chmodSync(directory, 0o700);
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("database backup lifecycle", () => {
  it("creates at most one verified daily backup per local date", async () => {
    const root = mkdtempSync(join(tmpdir(), "pff-backup-lifecycle-test-"));
    temporaryDirectories.push(root);
    const paths = resolveDataPaths({
      environment: { NODE_ENV: "test", PFF_DATA_DIR: join(root, "data") },
    });
    const context = await initializeDatabase({ paths });
    context.raw
      .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
      .run();
    const now = new Date(2026, 7, 19, 9, 0, 0);

    const first = await ensureDailyDatabaseBackup(context.raw, paths, now);
    context.raw
      .prepare("UPDATE app_settings SET updated_at = '2026-08-19 10:00:00'")
      .run();
    const second = await ensureDailyDatabaseBackup(
      context.raw,
      paths,
      new Date(2026, 7, 19, 18, 0, 0),
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(
      listDatabaseBackups(paths).filter((backup) => backup.reason === "daily"),
    ).toHaveLength(1);
    context.raw.close();
  });

  it("retains the newest backups plus monthly recovery points", async () => {
    const root = mkdtempSync(join(tmpdir(), "pff-backup-retention-test-"));
    temporaryDirectories.push(root);
    const paths = resolveDataPaths({
      environment: { NODE_ENV: "test", PFF_DATA_DIR: join(root, "data") },
    });
    const context = await initializeDatabase({ paths });
    context.raw
      .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
      .run();

    for (let monthOffset = 20; monthOffset >= 1; monthOffset -= 1) {
      context.raw
        .prepare("UPDATE app_settings SET updated_at = ?")
        .run(`2024-${String(monthOffset).padStart(2, "0")}-01`);
      await createDatabaseBackup(
        context.raw,
        paths,
        "manual",
        new Date(Date.UTC(2025, 7 - monthOffset, 1, 8, 0, 0)),
      );
    }
    for (let index = 0; index < 14; index += 1) {
      context.raw
        .prepare("UPDATE app_settings SET updated_at = ?")
        .run(`2026-08-19 12:${String(index).padStart(2, "0")}:00`);
      await createDatabaseBackup(
        context.raw,
        paths,
        "manual",
        new Date(Date.UTC(2026, 7, 19, 12, index, 0)),
      );
    }

    const backups = listDatabaseBackups(paths);
    expect(backups.slice(0, 14)).toHaveLength(14);
    expect(new Set(backups.map((backup) => backup.createdAt.slice(0, 7))).size).toBe(
      12,
    );
    expect(backups).toHaveLength(25);
    context.raw.close();
  });
});
