import type { FinancialAccountType } from "@/domain/accounts";
import type { ConfirmedType } from "@/domain/review/schemas";

export type EffectiveDateInput = {
  accountType: FinancialAccountType;
  transactionType: ConfirmedType | null;
  transactionDate: string;
  postedDate: string | null;
  amountMinor: number;
};

export function deriveDefaultEffectiveDate({
  accountType,
  transactionType,
  transactionDate,
  postedDate,
  amountMinor,
}: EffectiveDateInput): string {
  const isUntypedCreditCardCharge =
    accountType === "credit_card" && transactionType === null && amountMinor < 0;
  const usesCreditCardTransactionDate =
    accountType === "credit_card" &&
    (transactionType === "expense" ||
      transactionType === "refund" ||
      isUntypedCreditCardCharge);

  return usesCreditCardTransactionDate
    ? transactionDate
    : (postedDate ?? transactionDate);
}
