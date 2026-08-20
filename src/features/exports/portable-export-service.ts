import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { getDatabaseContext } from "@/db/client";

const portableTableNames = [
  "app_settings",
  "financial_accounts",
  "categories",
  "manual_items",
  "manual_item_valuations",
  "import_batches",
  "import_rows",
  "import_row_decisions",
  "import_row_category_allocations",
  "import_duplicate_candidates",
  "import_transfer_resolutions",
  "ledger_accounts",
  "journal_entries",
  "import_row_journal_entries",
  "postings",
  "audit_events",
  "monthly_budgets",
  "month_close_revisions",
  "month_close_states",
] as const;

type PortableTableName = (typeof portableTableNames)[number];
type PortableRow = Record<string, string | number | null>;

export type PortableFinancialExport = {
  format: "project-financial-freedom-portable-v1";
  generatedAt: string;
  appVersion: string;
  baseCurrency: string | null;
  appliedMigrations: number;
  checksumAlgorithm: "sha256";
  dataChecksum: string;
  tableChecksums: Record<PortableTableName, string>;
  sensitiveDataWarning: string;
  tables: Record<PortableTableName, PortableRow[]>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createPortableFinancialExportInDatabase(
  database: Database.Database,
  input: {
    generatedAt?: Date;
    appliedMigrations: number;
    appVersion?: string;
  },
): PortableFinancialExport {
  const tables = Object.fromEntries(
    portableTableNames.map((tableName) => [
      tableName,
      database
        .prepare(`SELECT * FROM "${tableName}" ORDER BY rowid`)
        .all() as PortableRow[],
    ]),
  ) as Record<PortableTableName, PortableRow[]>;
  const tableChecksums = Object.fromEntries(
    portableTableNames.map((tableName) => [
      tableName,
      sha256(JSON.stringify(tables[tableName])),
    ]),
  ) as Record<PortableTableName, string>;
  const settings = tables.app_settings[0];
  return {
    format: "project-financial-freedom-portable-v1",
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    appVersion: input.appVersion ?? "0.1.0",
    baseCurrency:
      typeof settings?.base_currency === "string" ? settings.base_currency : null,
    appliedMigrations: input.appliedMigrations,
    checksumAlgorithm: "sha256",
    dataChecksum: sha256(JSON.stringify(tables)),
    tableChecksums,
    sensitiveDataWarning:
      "This export contains private financial history. Store it encrypted or in a private local location and never commit it to version control.",
    tables,
  };
}

export async function createPortableFinancialExport(): Promise<{
  filename: string;
  content: string;
}> {
  const context = await getDatabaseContext();
  const generatedAt = new Date();
  const payload = context.raw.transaction(() =>
    createPortableFinancialExportInDatabase(context.raw, {
      generatedAt,
      appliedMigrations: context.health.appliedMigrations,
    }),
  )();
  return {
    filename: `project-financial-freedom-portable-${generatedAt.toISOString().replaceAll(":", "-")}.json`,
    content: `${JSON.stringify(payload, null, 2)}\n`,
  };
}
