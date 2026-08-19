import { describe, expect, it } from "vitest";

import { buildImportRowPostings } from "@/domain/import-posting";

const baseInput = {
  financialLedgerAccountId: 1,
  transferClearingLedgerAccountId: 2,
  manualAdjustmentsLedgerAccountId: 3,
} as const;

describe("import row postings", () => {
  it("posts split expenses, income, and refunds with ledger-correct signs", () => {
    expect(
      buildImportRowPostings({
        ...baseInput,
        amountMinor: -12_000,
        confirmedType: "expense",
        allocations: [
          { ledgerAccountId: 10, amountMinor: 9_000, categoryName: "Groceries" },
          { ledgerAccountId: 11, amountMinor: 3_000, categoryName: "Household" },
        ],
      }),
    ).toEqual([
      {
        ledgerAccountId: 1,
        amountMinor: -12_000,
        memo: "Imported financial-account activity",
      },
      { ledgerAccountId: 10, amountMinor: 9_000, memo: "Groceries" },
      { ledgerAccountId: 11, amountMinor: 3_000, memo: "Household" },
    ]);
    expect(
      buildImportRowPostings({
        ...baseInput,
        amountMinor: 300_000,
        confirmedType: "income",
        allocations: [
          { ledgerAccountId: 12, amountMinor: 300_000, categoryName: "Salary" },
        ],
      }),
    ).toEqual([
      {
        ledgerAccountId: 1,
        amountMinor: 300_000,
        memo: "Imported financial-account activity",
      },
      { ledgerAccountId: 12, amountMinor: -300_000, memo: "Salary" },
    ]);
    expect(
      buildImportRowPostings({
        ...baseInput,
        amountMinor: 2_000,
        confirmedType: "refund",
        allocations: [
          { ledgerAccountId: 10, amountMinor: 2_000, categoryName: "Groceries" },
        ],
      }),
    ).toEqual([
      {
        ledgerAccountId: 1,
        amountMinor: 2_000,
        memo: "Imported financial-account activity",
      },
      { ledgerAccountId: 10, amountMinor: -2_000, memo: "Groceries" },
    ]);
  });

  it("routes transfers and reviewed adjustments through their system accounts", () => {
    expect(
      buildImportRowPostings({
        ...baseInput,
        amountMinor: -50_000,
        confirmedType: "transfer",
        allocations: [],
      }),
    ).toEqual([
      {
        ledgerAccountId: 1,
        amountMinor: -50_000,
        memo: "Imported financial-account activity",
      },
      {
        ledgerAccountId: 2,
        amountMinor: 50_000,
        memo: "Imported transfer clearing",
      },
    ]);
    expect(
      buildImportRowPostings({
        ...baseInput,
        amountMinor: 125,
        confirmedType: "adjustment",
        allocations: [],
      }),
    ).toEqual([
      {
        ledgerAccountId: 1,
        amountMinor: 125,
        memo: "Imported financial-account activity",
      },
      {
        ledgerAccountId: 3,
        amountMinor: -125,
        memo: "Imported reviewed adjustment",
      },
    ]);
  });

  it("rejects zero amounts, incomplete allocations, and categories on transfers", () => {
    expect(() =>
      buildImportRowPostings({
        ...baseInput,
        amountMinor: 0,
        confirmedType: "transfer",
        allocations: [],
      }),
    ).toThrow("nonzero source amount");
    expect(() =>
      buildImportRowPostings({
        ...baseInput,
        amountMinor: -1_000,
        confirmedType: "expense",
        allocations: [
          { ledgerAccountId: 10, amountMinor: 999, categoryName: "Groceries" },
        ],
      }),
    ).toThrow("allocations must equal");
    expect(() =>
      buildImportRowPostings({
        ...baseInput,
        amountMinor: -1_000,
        confirmedType: "transfer",
        allocations: [
          { ledgerAccountId: 10, amountMinor: 1_000, categoryName: "Groceries" },
        ],
      }),
    ).toThrow("cannot post category allocations");
  });

  it.each([
    { confirmedType: "expense" as const, amountMinor: 1_000 },
    { confirmedType: "income" as const, amountMinor: -1_000 },
    { confirmedType: "refund" as const, amountMinor: -1_000 },
  ])(
    "rejects $confirmedType with the wrong source direction",
    ({ confirmedType, amountMinor }) => {
      expect(() =>
        buildImportRowPostings({
          ...baseInput,
          amountMinor,
          confirmedType,
          allocations: [
            { ledgerAccountId: 10, amountMinor: 1_000, categoryName: "Category" },
          ],
        }),
      ).toThrow("source amount in this direction");
    },
  );
});
