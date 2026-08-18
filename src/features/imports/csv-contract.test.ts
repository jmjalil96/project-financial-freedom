import { describe, expect, it } from "vitest";

import {
  computeFileChecksum,
  maximumCsvFileBytes,
  maximumCsvRows,
  parseCsvBytes,
} from "@/features/imports/csv-contract";

const encoder = new TextEncoder();

function parse(csv: string) {
  return parseCsvBytes(encoder.encode(csv), {
    accountType: "checking",
    baseCurrency: "USD",
  });
}

describe("CSV import v1 parser", () => {
  it("parses the minimal valid contract into normalized minor units", () => {
    const result = parse(
      [
        "transaction_date,description,amount,currency",
        "2026-08-04,WHOLE FOODS 102,-82.45,USD",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        originalRowNumber: 2,
        transactionDate: "2026-08-04",
        description: "WHOLE FOODS 102",
        amountMinor: -8245,
        currency: "USD",
        postedDate: null,
        suggestedType: null,
      }),
    ]);
  });

  it("uses transaction date for an untyped negative credit-card charge", () => {
    const result = parseCsvBytes(
      encoder.encode(
        [
          "transaction_date,posted_date,description,amount,currency",
          "2026-08-31,2026-09-02,CARD PURCHASE,-25.00,USD",
          "2026-08-20,2026-08-21,CARD PAYMENT,100.00,USD",
        ].join("\n"),
      ),
      {
        accountType: "credit_card",
        baseCurrency: "USD",
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.defaultEffectiveDate)).toEqual([
      "2026-08-31",
      "2026-08-21",
    ]);
  });

  it("supports a UTF-8 BOM, CRLF, quoted commas, quotes, and line breaks", () => {
    const result = parse(
      "\uFEFFtransaction_date,description,amount,currency,notes\r\n" +
        '2026-08-04,"MARKET, ""DOWNTOWN""",-12.34,USD,"First line\r\nSecond line"\r\n',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      originalRowNumber: 2,
      description: 'MARKET, "DOWNTOWN"',
      notes: "First line\r\nSecond line",
    });
  });

  it.each([
    {
      name: "LF header with CRLF rows",
      csv:
        "transaction_date,description,amount,currency\n" +
        "2026-08-01,Salary,1.00,USD\r\n" +
        "2026-08-02,Coffee,-2.00,USD\r\n",
    },
    {
      name: "CRLF header with LF rows",
      csv:
        "transaction_date,description,amount,currency\r\n" +
        "2026-08-01,Salary,1.00,USD\n" +
        "2026-08-02,Coffee,-2.00,USD\n",
    },
  ])("accepts mixed record delimiters: $name", ({ csv }) => {
    const result = parse(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.description)).toEqual(["Salary", "Coffee"]);
  });

  it("treats whitespace-only optional cells and records as blank", () => {
    const result = parse(
      [
        "transaction_date,posted_date,description,amount,currency,external_id,type,category",
        "   ",
        "2026-08-01,   ,Salary,1.00,USD,   ,   ,   ",
        "   ",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        originalRowNumber: 3,
        postedDate: null,
        externalId: null,
        suggestedType: null,
        suggestedCategory: null,
      }),
    ]);
  });

  it.each([
    {
      name: "missing required header",
      csv: "transaction_date,description,currency\n2026-08-01,Salary,USD",
      code: "missing_header",
    },
    {
      name: "unknown header",
      csv: "transaction_date,description,amount,currency,balance\n2026-08-01,Salary,1,USD,1",
      code: "unknown_header",
    },
    {
      name: "repeated header",
      csv: "transaction_date,description,amount,currency,amount\n2026-08-01,Salary,1,USD,1",
      code: "repeated_header",
    },
    {
      name: "invalid date",
      csv: "transaction_date,description,amount,currency\n2026-02-30,Salary,1,USD",
      code: "invalid_transaction_date",
    },
    {
      name: "excess precision",
      csv: "transaction_date,description,amount,currency\n2026-08-01,Salary,1.001,USD",
      code: "invalid_amount",
    },
    {
      name: "mismatched currency",
      csv: "transaction_date,description,amount,currency\n2026-08-01,Salary,1,EUR",
      code: "currency_mismatch",
    },
    {
      name: "unknown transaction type",
      csv: "transaction_date,description,amount,currency,type\n2026-08-01,Salary,1,USD,dividend",
      code: "unknown_type",
    },
  ])("rejects $name", ({ csv, code }) => {
    const result = parse(csv);

    expect(result.errors).toEqual([
      expect.objectContaining({
        code,
        severity: "error",
      }),
    ]);
  });

  it("rejects invalid UTF-8 bytes", () => {
    const result = parseCsvBytes(new Uint8Array([0xff, 0xfe, 0xfd]), {
      accountType: "checking",
      baseCurrency: "USD",
    });

    expect(result.errors[0]?.code).toBe("invalid_utf8");
  });

  it("enforces the documented file and row limits", () => {
    const oversizedFile = parseCsvBytes(new Uint8Array(maximumCsvFileBytes + 1), {
      accountType: "checking",
      baseCurrency: "USD",
    });
    const rows = Array.from(
      { length: maximumCsvRows + 1 },
      (_, index) => `2026-08-01,Row ${index},1.00,USD`,
    );
    const oversizedRows = parse(
      ["transaction_date,description,amount,currency", ...rows].join("\n"),
    );

    expect(oversizedFile.errors[0]?.code).toBe("file_too_large");
    expect(oversizedRows.errors[0]?.code).toBe("too_many_rows");
  });

  it("computes a stable SHA-256 checksum from the original bytes", () => {
    const bytes = encoder.encode("same source bytes");

    expect(computeFileChecksum(bytes)).toBe(
      "9a125616cfc2a7256a198a61218beec7b3fc3d9f126547d1fa4274d1d9923a7d",
    );
  });
});
