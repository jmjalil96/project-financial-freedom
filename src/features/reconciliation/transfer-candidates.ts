import { addCalendarDays, differenceInCalendarDays } from "@/domain/calendar-date";
import type { BaseCurrency } from "@/domain/currencies";
import type { ConfirmedType } from "@/domain/review";
import { transferMatchWindowDays } from "@/domain/transfers";

export type TransferCandidateSource = {
  id: number;
  accountId: number;
  accountName: string;
  currency: BaseCurrency;
  amountMinor: number;
  transactionDate: string;
  description: string;
  suggestedType: ConfirmedType | null;
  confirmedType: ConfirmedType | null;
};

export type TransferCandidateHint = {
  importRowId: number;
  candidateImportRowId: number;
  accountId: number;
  accountName: string;
  amountMinor: number;
  transactionDate: string;
  description: string;
  daysApart: number;
  typeSignal: "suggested" | "confirmed" | "counterpart";
};

export function getTransferCandidateWindow(transactionDates: readonly string[]): {
  startDate: string;
  endDate: string;
} {
  if (transactionDates.length === 0) {
    throw new Error("At least one target transaction date is required.");
  }
  const sortedDates = [...transactionDates].sort();
  return {
    startDate: addCalendarDays(sortedDates[0]!, -transferMatchWindowDays),
    endDate: addCalendarDays(sortedDates.at(-1)!, transferMatchWindowDays),
  };
}

function ownTypeSignal(row: TransferCandidateSource): "suggested" | "confirmed" | null {
  if (row.confirmedType === "transfer") {
    return "confirmed";
  }
  if (row.suggestedType === "transfer") {
    return "suggested";
  }
  return null;
}

export function deriveTransferCandidates(
  rows: readonly TransferCandidateSource[],
  targetRowIds?: ReadonlySet<number>,
): Map<number, TransferCandidateHint[]> {
  const result = new Map<number, TransferCandidateHint[]>();
  const buckets = new Map<string, TransferCandidateSource[]>();

  for (const row of rows) {
    if (row.amountMinor === 0) {
      continue;
    }
    const key = `${row.currency}:${Math.abs(row.amountMinor)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  const addHint = (
    owner: TransferCandidateSource,
    candidate: TransferCandidateSource,
    daysApart: number,
  ) => {
    if (targetRowIds && !targetRowIds.has(owner.id)) {
      return;
    }
    const ownerSignal = ownTypeSignal(owner);
    const candidateSignal = ownTypeSignal(candidate);
    if (!ownerSignal && !candidateSignal) {
      return;
    }
    const hints = result.get(owner.id) ?? [];
    hints.push({
      importRowId: owner.id,
      candidateImportRowId: candidate.id,
      accountId: candidate.accountId,
      accountName: candidate.accountName,
      amountMinor: candidate.amountMinor,
      transactionDate: candidate.transactionDate,
      description: candidate.description,
      daysApart,
      typeSignal: ownerSignal ?? "counterpart",
    });
    result.set(owner.id, hints);
  };

  for (const bucket of buckets.values()) {
    for (let firstIndex = 0; firstIndex < bucket.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < bucket.length;
        secondIndex += 1
      ) {
        const first = bucket[firstIndex]!;
        const second = bucket[secondIndex]!;
        if (
          first.accountId === second.accountId ||
          first.amountMinor !== -second.amountMinor
        ) {
          continue;
        }
        const daysApart = Math.abs(
          differenceInCalendarDays(first.transactionDate, second.transactionDate),
        );
        if (daysApart > transferMatchWindowDays) {
          continue;
        }
        addHint(first, second, daysApart);
        addHint(second, first, daysApart);
      }
    }
  }

  for (const hints of result.values()) {
    hints.sort(
      (first, second) =>
        first.daysApart - second.daysApart ||
        first.transactionDate.localeCompare(second.transactionDate) ||
        first.candidateImportRowId - second.candidateImportRowId,
    );
  }

  return result;
}
