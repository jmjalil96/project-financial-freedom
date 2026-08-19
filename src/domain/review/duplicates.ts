import { normalizeDescription } from "@/domain/review/description";

export const duplicateMatchKinds = ["none", "strong", "weak"] as const;
export type DuplicateMatchKind = (typeof duplicateMatchKinds)[number];

export type DuplicateMatchReason =
  "stable_external_id" | "account_amount_date_description" | null;

export type DuplicateMatchInput = {
  accountId: number | string;
  amountMinor: number;
  transactionDate: string;
  description: string;
  externalId?: string | null;
};

export type DuplicateMatch = {
  kind: DuplicateMatchKind;
  reason: DuplicateMatchReason;
};

export type DuplicateCandidateOrderInput = {
  id: number;
  strength: "strong" | "weak";
  matchKind: "external_id" | "signature" | "statement_overlap";
  createdAt: string;
};

const strengthPriority: Record<DuplicateCandidateOrderInput["strength"], number> = {
  strong: 0,
  weak: 1,
};

const candidateKindPriority: Record<DuplicateCandidateOrderInput["matchKind"], number> =
  {
    external_id: 0,
    signature: 1,
    statement_overlap: 2,
  };

export function compareDuplicateCandidates(
  first: DuplicateCandidateOrderInput,
  second: DuplicateCandidateOrderInput,
): number {
  return (
    strengthPriority[first.strength] - strengthPriority[second.strength] ||
    candidateKindPriority[first.matchKind] - candidateKindPriority[second.matchKind] ||
    first.createdAt.localeCompare(second.createdAt) ||
    first.id - second.id
  );
}

export function isSelectableDuplicateCandidate(
  status: "open" | "dismissed" | "confirmed",
): boolean {
  return status === "open" || status === "confirmed";
}

function normalizedExternalId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function classifyDuplicateMatch(
  first: DuplicateMatchInput,
  second: DuplicateMatchInput,
): DuplicateMatch {
  if (first.accountId !== second.accountId) {
    return { kind: "none", reason: null };
  }

  const firstExternalId = normalizedExternalId(first.externalId);
  const secondExternalId = normalizedExternalId(second.externalId);

  if (firstExternalId !== null && firstExternalId === secondExternalId) {
    return { kind: "strong", reason: "stable_external_id" };
  }

  if (
    first.amountMinor === second.amountMinor &&
    first.transactionDate === second.transactionDate &&
    normalizeDescription(first.description) === normalizeDescription(second.description)
  ) {
    return {
      kind: "weak",
      reason: "account_amount_date_description",
    };
  }

  return { kind: "none", reason: null };
}
