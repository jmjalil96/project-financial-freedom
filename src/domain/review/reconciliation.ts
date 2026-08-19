import { sumMinorUnits } from "@/domain/money";
import type { Disposition } from "@/domain/review/schemas";

export type ReconciliationActivity = {
  amountMinor: number;
  disposition?: Disposition | null;
};

export type ReconciliationInput = {
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  activity: readonly ReconciliationActivity[];
};

export type ReconciliationResult = {
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  sourceActivityTotalMinor: number;
  provisionalActivityTotalMinor: number;
  acceptedActivityTotalMinor: number;
  expectedClosingBalanceMinor: number;
  differenceMinor: number;
};

export function calculateReconciliation({
  openingBalanceMinor,
  closingBalanceMinor,
  activity,
}: ReconciliationInput): ReconciliationResult {
  const sourceActivityTotalMinor = sumMinorUnits(
    activity.map((row) => row.amountMinor),
    "The source activity total is too large.",
  );
  const provisionalActivityTotalMinor = sumMinorUnits(
    activity
      .filter(
        (row) => row.disposition !== "excluded" && row.disposition !== "duplicate",
      )
      .map((row) => row.amountMinor),
    "The provisional activity total is too large.",
  );
  const acceptedActivityTotalMinor = sumMinorUnits(
    activity
      .filter((row) => row.disposition === "accepted")
      .map((row) => row.amountMinor),
    "The accepted activity total is too large.",
  );
  const expectedClosingBalanceMinor = sumMinorUnits(
    [openingBalanceMinor, acceptedActivityTotalMinor],
    "The expected closing balance is too large.",
  );
  const differenceMinor = sumMinorUnits(
    [closingBalanceMinor, -expectedClosingBalanceMinor],
    "The reconciliation difference is too large.",
  );

  return {
    openingBalanceMinor,
    closingBalanceMinor,
    sourceActivityTotalMinor,
    provisionalActivityTotalMinor,
    acceptedActivityTotalMinor,
    expectedClosingBalanceMinor,
    differenceMinor,
  };
}
