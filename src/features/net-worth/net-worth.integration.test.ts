import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseContext } from "@/db/runtime";
import { createFinancialAccount } from "@/features/accounts/account-service";
import {
  commitValidatedImport,
  validateImportSource,
  type ImportSourceInput,
} from "@/features/imports/import-service";
import {
  archiveManualItem,
  carryForwardManualValuation,
  createManualItem,
  getNetWorthSnapshot,
  listOutsideScopeTransferAssignments,
  recordManualValuation,
  setOutsideScopeTransferManualItem,
} from "@/features/net-worth/net-worth-service";
import { finalizeImportBatch } from "@/features/reconciliation/finalization-service";
import { saveRowDecision } from "@/features/reconciliation/review-service";
import { classifyTransfer } from "@/features/transfers/transfer-service";
import {
  createIsolatedDatabase,
  destroyIsolatedDatabase,
} from "../../../test-fixtures/database-test-context";

const encoder = new TextEncoder();
let context: DatabaseContext;
let temporaryRoot: string;

async function commit(input: ImportSourceInput): Promise<number> {
  const validation = await validateImportSource(input);
  if (validation.status !== "ready") {
    throw new Error(validation.errors[0]?.message ?? "Import validation failed.");
  }
  const result = await commitValidatedImport(input, validation.preview.approvalToken);
  if (result.status !== "committed") {
    throw new Error(result.errors[0]?.message ?? "Import commit failed.");
  }
  return result.batchId;
}

beforeEach(async () => {
  ({ context, temporaryRoot } = await createIsolatedDatabase("pff-net-worth-test-"));
  context.raw
    .prepare("INSERT INTO app_settings (id, base_currency) VALUES (1, 'USD')")
    .run();
});

afterEach(() => {
  destroyIsolatedDatabase(context, temporaryRoot);
});

describe("Phase 6 manual valuations and net worth", () => {
  it("reproduces month-end assets, liabilities, debt, and prior-month change", async () => {
    await createFinancialAccount({
      name: "Net worth checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 100_000,
      requiredForClose: true,
    });
    await createFinancialAccount({
      name: "Net worth card",
      type: "credit_card",
      openingDate: "2026-08-01",
      openingBalanceMinor: 20_000,
      requiredForClose: true,
    });
    const homeId = await createManualItem({
      name: "Primary home",
      description: "Conservative market estimate",
      kind: "asset",
      openingDate: "2026-08-01",
      valuationFrequency: "quarterly",
    });
    const mortgageId = await createManualItem({
      name: "Home mortgage",
      kind: "liability",
      openingDate: "2026-08-01",
      valuationFrequency: "monthly",
    });
    await recordManualValuation({
      manualItemId: homeId,
      effectiveDate: "2026-08-15",
      naturalValueMinor: 25_000_000,
      sourceNote: "Comparable-sales estimate",
    });
    await recordManualValuation({
      manualItemId: mortgageId,
      effectiveDate: "2026-08-15",
      naturalValueMinor: 10_000_000,
      sourceNote: "August lender balance",
    });

    const snapshot = await getNetWorthSnapshot("2026-08");

    expect(snapshot).toMatchObject({
      netWorthMinor: 15_080_000,
      previousNetWorthMinor: 0,
      changeMinor: 15_080_000,
      debtMinor: 10_020_000,
      missingValuationCount: 0,
      staleValuationCount: 0,
    });
    expect(snapshot.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Primary home", amountMinor: 25_000_000 }),
        expect.objectContaining({ name: "Home mortgage", amountMinor: -10_000_000 }),
        expect.objectContaining({ name: "Net worth card", amountMinor: -20_000 }),
      ]),
    );
  });

  it("records corrections and carry-forwards without mutating valuation history", async () => {
    const vehicleId = await createManualItem({
      name: "Family vehicle",
      kind: "asset",
      openingDate: "2026-07-01",
      valuationFrequency: "monthly",
    });
    const julyId = await recordManualValuation({
      manualItemId: vehicleId,
      effectiveDate: "2026-07-31",
      naturalValueMinor: 1_000_000,
      sourceNote: "July market estimate",
    });
    expect((await getNetWorthSnapshot("2026-08")).staleValuationCount).toBe(1);

    const carriedId = await carryForwardManualValuation({
      manualItemId: vehicleId,
      sourceValuationId: julyId,
      effectiveDate: "2026-08-18",
      acknowledgment: "No material mileage or market change.",
    });
    const correctionId = await recordManualValuation({
      manualItemId: vehicleId,
      effectiveDate: "2026-08-18",
      naturalValueMinor: 900_000,
      sourceNote: "Corrected after checking the current market guide.",
    });
    const august = await getNetWorthSnapshot("2026-08");
    expect(august).toMatchObject({
      netWorthMinor: 900_000,
      staleValuationCount: 0,
      manualItems: [
        expect.objectContaining({
          valuationCount: 3,
          valuationHistory: expect.arrayContaining([
            expect.objectContaining({ id: correctionId, isSuperseded: false }),
            expect.objectContaining({ id: carriedId, isSuperseded: true }),
            expect.objectContaining({ id: julyId, isSuperseded: false }),
          ]),
          latestValuation: expect.objectContaining({
            id: correctionId,
            supersedesValuationId: carriedId,
            naturalValueMinor: 900_000,
          }),
        }),
      ],
    });
    expect(() =>
      context.raw
        .prepare("UPDATE manual_item_valuations SET value_minor = 1 WHERE id = ?")
        .run(correctionId),
    ).toThrow("immutable");
    expect(() =>
      context.raw
        .prepare("DELETE FROM manual_item_valuations WHERE id = ?")
        .run(julyId),
    ).toThrow("immutable");
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO manual_item_valuations
             (manual_item_id, effective_date, value_minor, source_note, origin)
           VALUES (?, '2026-08-18', 850000, 'Unlinked duplicate', 'manual')`,
        )
        .run(vehicleId),
    ).toThrow("inconsistent with its item");

    await archiveManualItem(vehicleId, "2026-08-19");
    expect((await getNetWorthSnapshot("2026-07")).netWorthMinor).toBe(1_000_000);
    expect((await getNetWorthSnapshot("2026-08")).netWorthMinor).toBe(0);
  });

  it("links outside-scope transfers only when a valuation can replace their balance", async () => {
    const accountId = await createFinancialAccount({
      name: "Transfer source checking",
      type: "checking",
      openingDate: "2026-08-01",
      openingBalanceMinor: 10_000,
      requiredForClose: true,
    });
    const source: ImportSourceInput = {
      financialAccountId: accountId,
      statementStartDate: "2026-08-01",
      statementEndDate: "2026-08-31",
      openingBalance: "100.00",
      closingBalance: "90.00",
      sourceFilename: "investment-transfer.csv",
      bytes: encoder.encode(
        "transaction_date,description,amount,currency,type\n2026-08-10,Transfer to private investment,-10.00,USD,transfer",
      ),
    };
    const batchId = await commit(source);
    const row = context.raw
      .prepare("SELECT id FROM import_rows WHERE import_batch_id = ?")
      .get(batchId) as { id: number };
    await saveRowDecision({
      importRowId: row.id,
      disposition: "accepted",
      confirmedType: "transfer",
    });
    await finalizeImportBatch(batchId);
    await classifyTransfer({
      importRowId: row.id,
      classification: "external_out",
    });
    const resolution = context.raw
      .prepare("SELECT id FROM import_transfer_resolutions WHERE import_row_id = ?")
      .get(row.id) as { id: number };
    expect((await getNetWorthSnapshot("2026-08")).netWorthMinor).toBe(10_000);

    const investmentId = await createManualItem({
      name: "Private investment",
      kind: "asset",
      openingDate: "2026-08-01",
      valuationFrequency: "monthly",
    });
    await setOutsideScopeTransferManualItem({
      transferResolutionId: resolution.id,
      manualItemId: investmentId,
    });
    const beforeValuation = await getNetWorthSnapshot("2026-08");
    expect(beforeValuation.netWorthMinor).toBe(10_000);
    expect(beforeValuation.unlinkedOutsideScopeMinor).toBe(1_000);

    await recordManualValuation({
      manualItemId: investmentId,
      effectiveDate: "2026-08-19",
      naturalValueMinor: 11_000,
      sourceNote: "August partner statement",
    });
    const afterValuation = await getNetWorthSnapshot("2026-08");
    expect(afterValuation).toMatchObject({
      netWorthMinor: 20_000,
      linkedOutsideScopeMinor: 1_000,
      unlinkedOutsideScopeMinor: 0,
    });
    expect(await listOutsideScopeTransferAssignments()).toEqual([
      expect.objectContaining({
        resolutionId: resolution.id,
        manualItemId: investmentId,
        manualItemName: "Private investment",
      }),
    ]);

    await archiveManualItem(investmentId, "2026-08-19");
    const afterArchive = await getNetWorthSnapshot("2026-08");
    expect(afterArchive).toMatchObject({
      netWorthMinor: 10_000,
      linkedOutsideScopeMinor: 0,
      unlinkedOutsideScopeMinor: 1_000,
    });
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO manual_item_valuations
             (manual_item_id, effective_date, value_minor, source_note, origin)
           VALUES (?, '2026-08-20', 12000, 'Late value', 'manual')`,
        )
        .run(investmentId),
    ).toThrow("inconsistent with its item");
  });

  it("prevents duplicate tracking identities and invalid signed valuations", async () => {
    await createManualItem({
      name: "Untracked brokerage",
      kind: "asset",
      openingDate: "2026-08-01",
      valuationFrequency: "monthly",
    });
    await expect(
      createFinancialAccount({
        name: "  untracked   brokerage ",
        type: "other_asset",
        openingDate: "2026-08-01",
        openingBalanceMinor: 0,
        requiredForClose: false,
      }),
    ).rejects.toThrow("already tracked as a manual item");
    const item = context.raw
      .prepare(
        "SELECT id FROM manual_items WHERE normalized_name = 'untracked brokerage'",
      )
      .get() as { id: number };
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO manual_item_valuations
             (manual_item_id, effective_date, value_minor, source_note, origin)
           VALUES (?, '2026-08-19', -100, 'Invalid asset sign', 'manual')`,
        )
        .run(item.id),
    ).toThrow("inconsistent with its item");
    expect(() =>
      context.raw
        .prepare(
          `INSERT INTO financial_accounts
             (name, type, currency, opening_date)
           VALUES ('Untracked brokerage', 'other_asset', 'USD', '2026-08-01')`,
        )
        .run(),
    ).toThrow("cannot be both");
  });
});
