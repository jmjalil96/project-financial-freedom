import { z } from "zod";

import { isLiabilityAccount, type FinancialAccountType } from "@/domain/accounts";
import { differenceInCalendarDays } from "@/domain/calendar-date";
import { DomainError } from "@/domain/errors";

export const transferMatchWindowDays = 3;

export const transferClassifications = [
  "owned_account",
  "card_payment",
  "external_out",
  "external_in",
  "in_transit",
] as const;

export const transferClassificationSchema = z.enum(transferClassifications);
export type TransferClassification = z.infer<typeof transferClassificationSchema>;

export function inferMatchedTransferClassification(
  firstAccountType: FinancialAccountType,
  secondAccountType: FinancialAccountType,
): "owned_account" | "card_payment" {
  return isLiabilityAccount(firstAccountType) !== isLiabilityAccount(secondAccountType)
    ? "card_payment"
    : "owned_account";
}

export function assertExternalTransferDirection(
  classification: "external_out" | "external_in",
  amountMinor: number,
): void {
  if (
    (classification === "external_out" && amountMinor >= 0) ||
    (classification === "external_in" && amountMinor <= 0)
  ) {
    throw new DomainError(
      classification === "external_out"
        ? "An external outbound transfer must decrease the owned account."
        : "An external inbound transfer must increase the owned account.",
    );
  }
}

export function assertTransferMatchWindow(
  firstTransactionDate: string,
  secondTransactionDate: string,
): void {
  if (
    Math.abs(differenceInCalendarDays(firstTransactionDate, secondTransactionDate)) >
    transferMatchWindowDays
  ) {
    throw new DomainError(
      `Matched transfers must be within ${transferMatchWindowDays} days of each other.`,
    );
  }
}
