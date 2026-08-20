import { DomainError } from "@/domain/errors";

export const manualItemKinds = ["asset", "liability"] as const;
export type ManualItemKind = (typeof manualItemKinds)[number];

export const valuationFrequencies = [
  "monthly",
  "quarterly",
  "annual",
  "ad_hoc",
] as const;
export type ValuationFrequency = (typeof valuationFrequencies)[number];

export const valuationFrequencyLabels: Record<ValuationFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  ad_hoc: "As needed",
};

export function normalizeManualItemName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function toSignedManualValue(
  kind: ManualItemKind,
  naturalAmountMinor: number,
): number {
  if (!Number.isSafeInteger(naturalAmountMinor) || naturalAmountMinor < 0) {
    throw new DomainError("Manual values must use nonnegative integer minor units.");
  }
  return kind === "asset" ? naturalAmountMinor : -naturalAmountMinor;
}

export function toNaturalManualValue(
  kind: ManualItemKind,
  signedAmountMinor: number,
): number {
  if (!Number.isSafeInteger(signedAmountMinor)) {
    throw new DomainError("The stored manual value is outside the safe money range.");
  }
  return kind === "asset" ? signedAmountMinor : -signedAmountMinor;
}

function calendarMonthIndex(date: string): number {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) {
    throw new DomainError("Valuation freshness requires valid calendar dates.");
  }
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export function isValuationStale(input: {
  valuationDate: string;
  monthEnd: string;
  frequency: ValuationFrequency;
}): boolean {
  if (input.valuationDate > input.monthEnd) {
    throw new DomainError("A future valuation cannot support an earlier month-end.");
  }
  if (input.frequency === "ad_hoc") {
    return false;
  }
  const elapsedMonths =
    calendarMonthIndex(input.monthEnd) - calendarMonthIndex(input.valuationDate);
  const allowedElapsedMonths =
    input.frequency === "monthly" ? 0 : input.frequency === "quarterly" ? 2 : 11;
  return elapsedMonths > allowedElapsedMonths;
}

export function shiftCalendarMonth(month: string, offset: number): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || !Number.isInteger(offset)) {
    throw new DomainError("A valid calendar month and integer offset are required.");
  }
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + offset;
  const year = Math.floor(index / 12);
  const monthNumber = (((index % 12) + 12) % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}
