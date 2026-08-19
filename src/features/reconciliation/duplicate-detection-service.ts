import { and, eq } from "drizzle-orm";

import { importBatches, importDuplicateCandidates, importRows } from "@/db/schema";
import type { AppTransaction } from "@/db/types";
import { DomainError } from "@/domain/errors";
import { normalizeDescription } from "@/domain/review";

export type DuplicateCandidateMatchKind =
  "external_id" | "signature" | "statement_overlap";
export type DuplicateCandidateStrength = "strong" | "weak";

export type DuplicateCandidateRefreshResult = {
  batchId: number;
  createdCount: number;
  updatedCount: number;
  candidateCount: number;
};

export const currentDuplicateScanVersion = 1;

type DuplicateSourceRow = {
  id: number;
  importBatchId: number;
  accountId: number;
  statementStartDate: string;
  statementEndDate: string;
  transactionDate: string;
  description: string;
  amountMinor: number;
  externalId: string | null;
};

type DesiredCandidate = {
  importRowId: number;
  candidateImportRowId: number;
  matchKind: DuplicateCandidateMatchKind;
  strength: DuplicateCandidateStrength;
};

const matchPriority: Record<DuplicateCandidateMatchKind, number> = {
  external_id: 3,
  signature: 2,
  statement_overlap: 1,
};

function normalizedExternalId(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function calendarDayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

function statementsOverlap(first: DuplicateSourceRow, second: DuplicateSourceRow) {
  return (
    first.importBatchId !== second.importBatchId &&
    first.statementStartDate <= second.statementEndDate &&
    second.statementStartDate <= first.statementEndDate
  );
}

function addDesiredCandidate(
  desired: Map<string, DesiredCandidate>,
  first: DuplicateSourceRow,
  second: DuplicateSourceRow,
  targetRowIds: ReadonlySet<number>,
  matchKind: DuplicateCandidateMatchKind,
  strength: DuplicateCandidateStrength,
): void {
  if (first.id === second.id) {
    return;
  }

  // Source row ids are monotonic. Giving the later row ownership keeps a single
  // directional edge for a pair and naturally makes a future import point back
  // to existing evidence.
  const owner = first.id > second.id ? first : second;
  const candidate = owner === first ? second : first;

  if (!targetRowIds.has(owner.id)) {
    return;
  }

  const key = `${owner.id}:${candidate.id}`;
  const existing = desired.get(key);

  if (!existing || matchPriority[matchKind] > matchPriority[existing.matchKind]) {
    desired.set(key, {
      importRowId: owner.id,
      candidateImportRowId: candidate.id,
      matchKind,
      strength,
    });
  }
}

function groupRows(
  rows: readonly DuplicateSourceRow[],
  getKey: (row: DuplicateSourceRow) => string | null,
): Map<string, DuplicateSourceRow[]> {
  const groups = new Map<string, DuplicateSourceRow[]>();

  for (const row of rows) {
    const key = getKey(row);

    if (key === null) {
      continue;
    }

    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return groups;
}

function addEveryPair(
  groups: ReadonlyMap<string, readonly DuplicateSourceRow[]>,
  addPair: (first: DuplicateSourceRow, second: DuplicateSourceRow) => void,
): void {
  for (const group of groups.values()) {
    for (let firstIndex = 0; firstIndex < group.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < group.length;
        secondIndex += 1
      ) {
        addPair(group[firstIndex]!, group[secondIndex]!);
      }
    }
  }
}

/**
 * Refreshes candidates owned by rows in one batch.
 *
 * The caller supplies its transaction so import sealing, candidate discovery,
 * and later finalization checks can remain atomic. Existing candidate statuses
 * are deliberately never overwritten.
 */
export function refreshDuplicateCandidatesForBatch(
  transaction: AppTransaction,
  importBatchId: number,
): DuplicateCandidateRefreshResult {
  const batch = transaction
    .select({
      id: importBatches.id,
      financialAccountId: importBatches.financialAccountId,
      reviewStatus: importBatches.reviewStatus,
    })
    .from(importBatches)
    .where(eq(importBatches.id, importBatchId))
    .get();

  if (!batch) {
    throw new DomainError("The import statement does not exist.");
  }

  if (batch.reviewStatus === "finalized") {
    throw new DomainError("A finalized statement cannot be changed.");
  }

  const allRows: DuplicateSourceRow[] = transaction
    .select({
      id: importRows.id,
      importBatchId: importRows.importBatchId,
      accountId: importBatches.financialAccountId,
      statementStartDate: importBatches.statementStartDate,
      statementEndDate: importBatches.statementEndDate,
      transactionDate: importRows.transactionDate,
      description: importRows.description,
      amountMinor: importRows.amountMinor,
      externalId: importRows.externalId,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.importBatchId))
    .where(eq(importBatches.financialAccountId, batch.financialAccountId))
    .all();
  const targetRowIds = new Set(
    allRows.filter((row) => row.importBatchId === importBatchId).map((row) => row.id),
  );
  const desired = new Map<string, DesiredCandidate>();
  const externalIdGroups = groupRows(allRows, (row) =>
    normalizedExternalId(row.externalId),
  );

  addEveryPair(externalIdGroups, (first, second) => {
    addDesiredCandidate(desired, first, second, targetRowIds, "external_id", "strong");
  });

  const signatureGroups = groupRows(
    allRows,
    (row) =>
      `${row.amountMinor}\u0000${row.transactionDate}\u0000${normalizeDescription(row.description)}`,
  );
  addEveryPair(signatureGroups, (first, second) => {
    addDesiredCandidate(desired, first, second, targetRowIds, "signature", "weak");
  });

  const overlapGroups = groupRows(
    allRows,
    (row) => `${row.amountMinor}\u0000${normalizeDescription(row.description)}`,
  );
  addEveryPair(overlapGroups, (first, second) => {
    if (
      statementsOverlap(first, second) &&
      Math.abs(
        calendarDayNumber(first.transactionDate) -
          calendarDayNumber(second.transactionDate),
      ) <= 3
    ) {
      addDesiredCandidate(
        desired,
        first,
        second,
        targetRowIds,
        "statement_overlap",
        "weak",
      );
    }
  });

  const existing = transaction
    .select({
      id: importDuplicateCandidates.id,
      importRowId: importDuplicateCandidates.importRowId,
      candidateImportRowId: importDuplicateCandidates.candidateImportRowId,
      matchKind: importDuplicateCandidates.matchKind,
      strength: importDuplicateCandidates.strength,
    })
    .from(importDuplicateCandidates)
    .innerJoin(importRows, eq(importRows.id, importDuplicateCandidates.importRowId))
    .where(eq(importRows.importBatchId, importBatchId))
    .all();
  const existingByPair = new Map(
    existing.map((candidate) => [
      `${candidate.importRowId}:${candidate.candidateImportRowId}`,
      candidate,
    ]),
  );
  const inserts: DesiredCandidate[] = [];
  let updatedCount = 0;

  for (const [key, candidate] of desired) {
    const prior = existingByPair.get(key);

    if (!prior) {
      inserts.push(candidate);
      continue;
    }

    if (
      prior.matchKind !== candidate.matchKind ||
      prior.strength !== candidate.strength
    ) {
      transaction
        .update(importDuplicateCandidates)
        .set({
          matchKind: candidate.matchKind,
          strength: candidate.strength,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(importDuplicateCandidates.id, prior.id),
            eq(importDuplicateCandidates.importRowId, candidate.importRowId),
          ),
        )
        .run();
      updatedCount += 1;
    }
  }

  for (let offset = 0; offset < inserts.length; offset += 250) {
    transaction
      .insert(importDuplicateCandidates)
      .values(inserts.slice(offset, offset + 250))
      .onConflictDoNothing()
      .run();
  }

  transaction
    .update(importBatches)
    .set({ duplicateScanVersion: currentDuplicateScanVersion })
    .where(eq(importBatches.id, importBatchId))
    .run();

  return {
    batchId: importBatchId,
    createdCount: inserts.length,
    updatedCount,
    candidateCount: desired.size,
  };
}
