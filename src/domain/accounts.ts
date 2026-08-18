import { z } from "zod";

export const financialAccountTypes = [
  { value: "checking", label: "Checking", ledgerKind: "asset" },
  { value: "savings", label: "Savings", ledgerKind: "asset" },
  { value: "cash", label: "Cash", ledgerKind: "asset" },
  { value: "credit_card", label: "Credit card", ledgerKind: "liability" },
  { value: "loan", label: "Loan", ledgerKind: "liability" },
  { value: "other_asset", label: "Other asset account", ledgerKind: "asset" },
  {
    value: "other_liability",
    label: "Other liability account",
    ledgerKind: "liability",
  },
] as const;

export const financialAccountTypeSchema = z.enum(
  financialAccountTypes.map((type) => type.value) as [
    (typeof financialAccountTypes)[number]["value"],
    ...(typeof financialAccountTypes)[number]["value"][],
  ],
);

export type FinancialAccountType = z.infer<typeof financialAccountTypeSchema>;

export function getFinancialAccountType(
  type: FinancialAccountType,
): (typeof financialAccountTypes)[number] {
  return financialAccountTypes.find((candidate) => candidate.value === type)!;
}

export function isLiabilityAccount(type: FinancialAccountType): boolean {
  return getFinancialAccountType(type).ledgerKind === "liability";
}

export function toLedgerBalance(
  type: FinancialAccountType,
  naturalAmountMinor: number,
): number {
  if (naturalAmountMinor === 0) {
    return 0;
  }

  return isLiabilityAccount(type) ? -naturalAmountMinor : naturalAmountMinor;
}

export function toNaturalBalance(
  type: FinancialAccountType,
  ledgerAmountMinor: number,
): number {
  if (ledgerAmountMinor === 0) {
    return 0;
  }

  return isLiabilityAccount(type) ? -ledgerAmountMinor : ledgerAmountMinor;
}
