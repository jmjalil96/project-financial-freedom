import { createHash } from "node:crypto";

import { parse } from "csv-parse/sync";

import type { FinancialAccountType } from "@/domain/accounts";
import { isCalendarDate } from "@/domain/calendar-date";
import type { BaseCurrency } from "@/domain/currencies";
import { parseMoneyToMinorUnits } from "@/domain/money";
import { deriveDefaultEffectiveDate } from "@/domain/review/effective-date";

export const csvSchemaVersion = "csv-v1" as const;
export const maximumCsvFileBytes = 5 * 1024 * 1024;
export const maximumCsvRows = 5_000;
export const maximumCsvRecordCharacters = 100_000;

export const requiredCsvHeaders = [
  "transaction_date",
  "description",
  "amount",
  "currency",
] as const;

export const optionalCsvHeaders = [
  "posted_date",
  "external_id",
  "merchant",
  "type",
  "category",
  "notes",
] as const;

const acceptedCsvHeaders = new Set<string>([
  ...requiredCsvHeaders,
  ...optionalCsvHeaders,
]);

const acceptedSuggestedTypes = new Set([
  "income",
  "expense",
  "transfer",
  "refund",
  "adjustment",
]);

export type CsvSuggestedType =
  "income" | "expense" | "transfer" | "refund" | "adjustment";

export type ImportIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
};

export type NormalizedCsvRow = {
  originalRowNumber: number;
  transactionDate: string;
  postedDate: string | null;
  description: string;
  amountMinor: number;
  currency: BaseCurrency;
  externalId: string | null;
  merchant: string | null;
  suggestedType: CsvSuggestedType | null;
  suggestedCategory: string | null;
  notes: string | null;
  defaultEffectiveDate: string;
};

export type ParsedCsv = {
  rows: NormalizedCsvRow[];
  errors: ImportIssue[];
};

type CsvRecord = {
  record: string[];
  line: number;
};

function optionalValue(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value;
}

function rowValue(
  record: string[],
  headerIndexes: Map<string, number>,
  header: string,
): string {
  const index = headerIndexes.get(header);
  return index === undefined ? "" : (record[index] ?? "");
}

function parseCsvRecords(text: string): CsvRecord[] {
  const recordStartLines: number[] = [];
  let currentLine = 1;
  let recordStartLine = 1;
  let recordHasContent = false;
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;

    if (character === '"') {
      if (insideQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      recordHasContent = true;
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      if (!insideQuotes) {
        if (recordHasContent) {
          recordStartLines.push(recordStartLine);
        }
        recordHasContent = false;
        recordStartLine = currentLine + 1;
      }

      currentLine += 1;
      continue;
    }

    recordHasContent = true;
  }

  if (recordHasContent) {
    recordStartLines.push(recordStartLine);
  }

  const records = parse(text, {
    bom: true,
    max_record_size: maximumCsvRecordCharacters,
    record_delimiter: ["\r\n", "\n", "\r"],
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];

  return records.map((record, index) => ({
    record,
    line: recordStartLines[index] ?? 1,
  }));
}

export function parseCsvBytes(
  bytes: Uint8Array,
  input: {
    accountType: FinancialAccountType;
    baseCurrency: BaseCurrency;
  },
): ParsedCsv {
  const errors: ImportIssue[] = [];

  if (bytes.byteLength === 0) {
    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "empty_file",
          message: "The selected CSV is empty.",
        },
      ],
    };
  }

  if (bytes.byteLength > maximumCsvFileBytes) {
    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "file_too_large",
          message: "The CSV exceeds the 5 MB file limit.",
        },
      ],
    };
  }

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "invalid_utf8",
          message: "The CSV must use valid UTF-8 encoding.",
        },
      ],
    };
  }

  if (text.includes("\0")) {
    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "null_byte",
          message: "The CSV contains unsupported null bytes.",
        },
      ],
    };
  }

  let records: CsvRecord[];

  try {
    records = parseCsvRecords(text);
  } catch (error) {
    const csvError = error as Error & { lines?: number };

    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "malformed_csv",
          message: `The CSV could not be parsed: ${csvError.message}`,
          rowNumber: csvError.lines,
        },
      ],
    };
  }

  const headerRecord = records[0];

  if (!headerRecord) {
    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "missing_header",
          message: "The CSV requires a header row.",
          rowNumber: 1,
        },
      ],
    };
  }

  const headers = headerRecord.record;
  const repeatedHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  const unknownHeaders = headers.filter((header) => !acceptedCsvHeaders.has(header));
  const missingHeaders = requiredCsvHeaders.filter(
    (header) => !headers.includes(header),
  );

  if (repeatedHeaders.length > 0) {
    errors.push({
      severity: "error",
      code: "repeated_header",
      message: `Repeated header: ${[...new Set(repeatedHeaders)].join(", ")}.`,
      rowNumber: headerRecord.line,
    });
  }

  if (unknownHeaders.length > 0) {
    errors.push({
      severity: "error",
      code: "unknown_header",
      message: `Unknown header: ${[...new Set(unknownHeaders)].join(", ")}.`,
      rowNumber: headerRecord.line,
    });
  }

  if (missingHeaders.length > 0) {
    errors.push({
      severity: "error",
      code: "missing_header",
      message: `Missing required header: ${missingHeaders.join(", ")}.`,
      rowNumber: headerRecord.line,
    });
  }

  if (errors.length > 0) {
    return { rows: [], errors };
  }

  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const dataRecords = records
    .slice(1)
    .filter(({ record }) => record.some((value) => value.trim() !== ""));

  if (dataRecords.length > maximumCsvRows) {
    return {
      rows: [],
      errors: [
        {
          severity: "error",
          code: "too_many_rows",
          message: `The CSV exceeds the ${maximumCsvRows.toLocaleString("en-US")} row limit.`,
        },
      ],
    };
  }

  const rows: NormalizedCsvRow[] = [];

  for (const { record, line } of dataRecords) {
    const rowErrors: ImportIssue[] = [];

    if (record.length !== headers.length) {
      rowErrors.push({
        severity: "error",
        code: "column_count",
        message: `Expected ${headers.length} columns but found ${record.length}.`,
        rowNumber: line,
      });
    }

    const transactionDate = rowValue(record, headerIndexes, "transaction_date");
    const postedDate = optionalValue(rowValue(record, headerIndexes, "posted_date"));
    const description = rowValue(record, headerIndexes, "description");
    const rawAmount = rowValue(record, headerIndexes, "amount");
    const rawCurrency = rowValue(record, headerIndexes, "currency");
    const rawSuggestedType = optionalValue(rowValue(record, headerIndexes, "type"));

    if (!isCalendarDate(transactionDate)) {
      rowErrors.push({
        severity: "error",
        code: "invalid_transaction_date",
        field: "transaction_date",
        message: "Enter transaction_date as a valid YYYY-MM-DD date.",
        rowNumber: line,
      });
    }

    if (postedDate && !isCalendarDate(postedDate)) {
      rowErrors.push({
        severity: "error",
        code: "invalid_posted_date",
        field: "posted_date",
        message: "Enter posted_date as a valid YYYY-MM-DD date or leave it blank.",
        rowNumber: line,
      });
    }

    if (!description.trim()) {
      rowErrors.push({
        severity: "error",
        code: "missing_description",
        field: "description",
        message: "Description is required.",
        rowNumber: line,
      });
    }

    let amountMinor: number | null = null;

    try {
      amountMinor = parseMoneyToMinorUnits(rawAmount, input.baseCurrency, {
        allowZero: false,
      });
    } catch (error) {
      rowErrors.push({
        severity: "error",
        code: "invalid_amount",
        field: "amount",
        message: error instanceof Error ? error.message : "Enter a valid amount.",
        rowNumber: line,
      });
    }

    if (rawCurrency !== input.baseCurrency) {
      rowErrors.push({
        severity: "error",
        code: "currency_mismatch",
        field: "currency",
        message: `Currency must be ${input.baseCurrency}.`,
        rowNumber: line,
      });
    }

    if (rawSuggestedType && !acceptedSuggestedTypes.has(rawSuggestedType)) {
      rowErrors.push({
        severity: "error",
        code: "unknown_type",
        field: "type",
        message: `Unsupported type suggestion: ${rawSuggestedType}.`,
        rowNumber: line,
      });
    }

    if (rowErrors.length > 0 || amountMinor === null) {
      errors.push(...rowErrors);
      continue;
    }

    const suggestedType = rawSuggestedType as CsvSuggestedType | null;
    const defaultEffectiveDate = deriveDefaultEffectiveDate({
      accountType: input.accountType,
      transactionType: suggestedType,
      transactionDate,
      postedDate,
      amountMinor,
    });

    rows.push({
      originalRowNumber: line,
      transactionDate,
      postedDate,
      description,
      amountMinor,
      currency: input.baseCurrency,
      externalId: optionalValue(rowValue(record, headerIndexes, "external_id")),
      merchant: optionalValue(rowValue(record, headerIndexes, "merchant")),
      suggestedType,
      suggestedCategory: optionalValue(rowValue(record, headerIndexes, "category")),
      notes: optionalValue(rowValue(record, headerIndexes, "notes")),
      defaultEffectiveDate,
    });
  }

  if (dataRecords.length === 0) {
    errors.push({
      severity: "error",
      code: "no_rows",
      message: "The CSV contains no transaction rows.",
    });
  }

  return { rows, errors };
}

export function computeFileChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeRowFingerprint(
  financialAccountId: number,
  row: Pick<
    NormalizedCsvRow,
    "transactionDate" | "postedDate" | "description" | "amountMinor"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        financialAccountId,
        row.transactionDate,
        row.postedDate,
        row.description,
        row.amountMinor,
      ]),
    )
    .digest("hex");
}
