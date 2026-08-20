import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import { createFinancialAccount } from "@/features/accounts/account-service";
import { createPortableFinancialExportInDatabase } from "@/features/exports/portable-export-service";
import { reverseJournalEntry } from "@/features/ledger/ledger-service";
import { closeMonth, reopenMonth } from "@/features/month-close/month-close-service";
import {
  createManualDatabaseBackup,
  getBackupRestorePreview,
  restoreDatabaseBackup,
} from "@/features/recovery/recovery-service";
import { createManualTransaction } from "@/features/transactions/manual-transaction-service";
import { listDatabaseBackups } from "@/server/database-backup";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../test-fixtures/database-test-context";

let context: DatabaseContext;
let temporaryRoot: string;

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-phase-nine-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
});

afterEach(async () => {
  if (globalThis.__pffDatabaseContext) {
    context = await globalThis.__pffDatabaseContext;
  }
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 9 recovery and exports", () => {
  it("restores a verified snapshot and keeps a safety copy of the replaced database", async () => {
    await createFinancialAccount({
      name: "Before backup",
      type: "cash",
      openingDate: "2026-01-01",
      openingBalanceMinor: 10_000,
      requiredForClose: false,
    });
    const source = await createManualDatabaseBackup();
    await createFinancialAccount({
      name: "After backup",
      type: "cash",
      openingDate: "2026-02-01",
      openingBalanceMinor: 20_000,
      requiredForClose: false,
    });

    const preview = await getBackupRestorePreview(source.filename);
    expect(preview).toMatchObject({
      baseCurrency: "USD",
      appliedMigrations: 16,
      requiresMigration: false,
      counts: { accounts: 1, journalEntries: 1 },
    });
    const previewPath = join(context.paths.backupDirectory, source.filename);
    expect(existsSync(`${previewPath}-wal`)).toBe(false);
    expect(existsSync(`${previewPath}-shm`)).toBe(false);

    const restored = await restoreDatabaseBackup(source.filename);
    context = await globalThis.__pffDatabaseContext!;
    expect(
      context.raw.prepare("SELECT name FROM financial_accounts ORDER BY id").all(),
    ).toEqual([{ name: "Before backup" }]);
    expect(context.raw.pragma("quick_check", { simple: true })).toBe("ok");
    expect(context.raw.pragma("foreign_key_check")).toEqual([]);
    expect(
      context.raw
        .prepare("SELECT count(*) AS count FROM audit_events WHERE action = ?")
        .get("database.restored"),
    ).toEqual({ count: 1 });

    const safetyPreview = await getBackupRestorePreview(restored.safetyBackupFilename);
    expect(safetyPreview.counts.accounts).toBe(2);
  });

  it("creates safety backups before a reversal and before reopening a close", async () => {
    const accountId = await createFinancialAccount({
      name: "Safety cash",
      type: "cash",
      openingDate: "2025-01-01",
      openingBalanceMinor: 100_000,
      requiredForClose: false,
    });
    const category = context.raw
      .prepare("SELECT id FROM categories WHERE slug = 'groceries'")
      .get() as { id: number };
    const journalEntryId = await createManualTransaction({
      kind: "expense",
      effectiveDate: "2025-01-10",
      description: "Safety groceries",
      amountMinor: 1_000,
      financialAccountId: accountId,
      categoryId: category.id,
    });
    await reverseJournalEntry({
      journalEntryId,
      reason: "Verify correction recovery",
    });
    await closeMonth("2025-01");
    await reopenMonth({
      targetMonth: "2025-01",
      reason: "Verify reopen recovery",
    });

    expect(listDatabaseBackups(context.paths).map((backup) => backup.reason)).toEqual(
      expect.arrayContaining(["pre-correction", "pre-reopen"]),
    );
    const reopenBackup = listDatabaseBackups(context.paths).find(
      (backup) => backup.reason === "pre-reopen",
    );
    expect(reopenBackup).toBeDefined();
    const preview = await getBackupRestorePreview(reopenBackup!.filename);
    expect(preview.counts.closeRevisions).toBe(1);
  });

  it("exports every financial table with verifiable metadata and checksums", () => {
    const payload = createPortableFinancialExportInDatabase(context.raw, {
      appliedMigrations: context.health.appliedMigrations,
      generatedAt: new Date("2026-08-19T12:00:00.000Z"),
    });
    expect(payload).toMatchObject({
      format: "project-financial-freedom-portable-v1",
      generatedAt: "2026-08-19T12:00:00.000Z",
      baseCurrency: "USD",
      appliedMigrations: 16,
      checksumAlgorithm: "sha256",
    });
    expect(Object.keys(payload.tables)).toHaveLength(19);
    expect(payload.tables.app_settings).toHaveLength(1);
    expect(payload.dataChecksum).toBe(
      createHash("sha256").update(JSON.stringify(payload.tables), "utf8").digest("hex"),
    );
    expect(payload.tableChecksums.app_settings).toBe(
      createHash("sha256")
        .update(JSON.stringify(payload.tables.app_settings), "utf8")
        .digest("hex"),
    );
  });

  it("rejects a damaged restore candidate without replacing the live database", async () => {
    const accountId = await createFinancialAccount({
      name: "Still live",
      type: "cash",
      openingDate: "2026-01-01",
      openingBalanceMinor: 1_000,
      requiredForClose: false,
    });
    const backup = await createManualDatabaseBackup();
    writeFileSync(join(context.paths.backupDirectory, backup.filename), "damaged");

    await expect(restoreDatabaseBackup(backup.filename)).rejects.toThrow();
    expect(context.raw.open).toBe(true);
    expect(
      context.raw
        .prepare("SELECT id FROM financial_accounts WHERE id = ?")
        .get(accountId),
    ).toEqual({ id: accountId });
  });
});
