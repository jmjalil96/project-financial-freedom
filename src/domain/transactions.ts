export const manualTransactionKinds = [
  "expense",
  "income",
  "refund",
  "transfer",
  "adjustment",
] as const;

export type ManualTransactionKind = (typeof manualTransactionKinds)[number];

export function getRequiredCategoryKind(
  kind: ManualTransactionKind,
): "income" | "expense" | null {
  if (kind === "income") {
    return "income";
  }

  if (kind === "expense" || kind === "refund") {
    return "expense";
  }

  return null;
}
