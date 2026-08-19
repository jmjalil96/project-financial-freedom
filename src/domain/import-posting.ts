import { DomainError } from "@/domain/errors";
import type { ConfirmedType } from "@/domain/review";

export type ImportPostingAllocation = {
  ledgerAccountId: number;
  amountMinor: number;
  categoryName: string;
};

export type ImportPosting = {
  ledgerAccountId: number;
  amountMinor: number;
  memo?: string;
};

export function buildImportRowPostings(input: {
  amountMinor: number;
  confirmedType: ConfirmedType;
  financialLedgerAccountId: number;
  transferClearingLedgerAccountId: number;
  manualAdjustmentsLedgerAccountId: number;
  allocations: readonly ImportPostingAllocation[];
}): ImportPosting[] {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
    throw new DomainError("Accepted import rows must have a nonzero source amount.");
  }

  const financialPosting: ImportPosting = {
    ledgerAccountId: input.financialLedgerAccountId,
    amountMinor: input.amountMinor,
    memo: "Imported financial-account activity",
  };

  if (
    input.confirmedType === "income" ||
    input.confirmedType === "expense" ||
    input.confirmedType === "refund"
  ) {
    const directionIsValid =
      (input.confirmedType === "expense" && input.amountMinor < 0) ||
      (input.confirmedType !== "expense" && input.amountMinor > 0);
    if (!directionIsValid) {
      throw new DomainError(
        `${input.confirmedType === "expense" ? "Expenses" : input.confirmedType === "income" ? "Income" : "Refunds"} cannot be posted with the source amount in this direction.`,
      );
    }
    const allocationTotal = input.allocations.reduce(
      (total, allocation) => total + allocation.amountMinor,
      0,
    );
    if (allocationTotal !== Math.abs(input.amountMinor)) {
      throw new DomainError(
        "Category allocations must equal the imported amount before posting.",
      );
    }
    const counterSign = input.confirmedType === "expense" ? 1 : -1;
    return [
      financialPosting,
      ...input.allocations.map((allocation) => ({
        ledgerAccountId: allocation.ledgerAccountId,
        amountMinor: counterSign * allocation.amountMinor,
        memo: allocation.categoryName,
      })),
    ];
  }

  if (input.allocations.length > 0) {
    throw new DomainError(
      "Transfers and adjustments cannot post category allocations.",
    );
  }

  return [
    financialPosting,
    {
      ledgerAccountId:
        input.confirmedType === "transfer"
          ? input.transferClearingLedgerAccountId
          : input.manualAdjustmentsLedgerAccountId,
      amountMinor: -input.amountMinor,
      memo:
        input.confirmedType === "transfer"
          ? "Imported transfer clearing"
          : "Imported reviewed adjustment",
    },
  ];
}
