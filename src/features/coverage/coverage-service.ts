import { lte } from "drizzle-orm";

import { getDatabaseContext } from "@/db/client";
import { financialAccounts, importBatches } from "@/db/schema";
import { getCalendarMonthBounds } from "@/domain/calendar-date";
import {
  evaluateAccountCoverage,
  type AccountCoverageResult,
  type StatementCoverageInterval,
} from "@/domain/coverage";
import { financialAccountTypeSchema } from "@/domain/accounts";

export type MonthCoverageSummary = {
  targetMonth: string;
  monthEnd: string;
  requiredAccountCount: number;
  completeAccountCount: number;
  blockedAccountCount: number;
  isCoverageComplete: boolean;
  accounts: AccountCoverageResult[];
};

export async function getMonthCoverage(
  targetMonth: string,
): Promise<MonthCoverageSummary> {
  const month = getCalendarMonthBounds(targetMonth);
  const { db } = await getDatabaseContext();
  const accounts = db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      type: financialAccounts.type,
      requiredForClose: financialAccounts.requiredForClose,
      openingDate: financialAccounts.openingDate,
      archivedAt: financialAccounts.archivedAt,
      archivedOn: financialAccounts.archivedOn,
    })
    .from(financialAccounts)
    .orderBy(financialAccounts.archivedAt, financialAccounts.createdAt)
    .all();
  const batches = db
    .select({
      id: importBatches.id,
      financialAccountId: importBatches.financialAccountId,
      sourceFilename: importBatches.sourceFilename,
      statementStartDate: importBatches.statementStartDate,
      statementEndDate: importBatches.statementEndDate,
      reviewStatus: importBatches.reviewStatus,
    })
    .from(importBatches)
    .where(lte(importBatches.statementStartDate, month.end))
    .orderBy(importBatches.statementStartDate, importBatches.id)
    .all();
  const statementsByAccount = new Map<number, StatementCoverageInterval[]>();
  for (const batch of batches) {
    const reviewStatus =
      batch.reviewStatus === "pending" ||
      batch.reviewStatus === "in_review" ||
      batch.reviewStatus === "finalized"
        ? batch.reviewStatus
        : null;
    if (!reviewStatus) {
      throw new Error(`Unknown import review status: ${batch.reviewStatus}`);
    }
    const statements = statementsByAccount.get(batch.financialAccountId) ?? [];
    statements.push({
      batchId: batch.id,
      sourceFilename: batch.sourceFilename,
      start: batch.statementStartDate,
      end: batch.statementEndDate,
      reviewStatus,
    });
    statementsByAccount.set(batch.financialAccountId, statements);
  }

  const results = accounts.map((account) => {
    financialAccountTypeSchema.parse(account.type);
    return evaluateAccountCoverage({
      account: {
        id: account.id,
        name: account.name,
        type: account.type,
        requiredForClose: account.requiredForClose,
        openingDate: account.openingDate,
        archivedOn: account.archivedOn ?? account.archivedAt?.slice(0, 10) ?? null,
      },
      targetMonth,
      statements: statementsByAccount.get(account.id) ?? [],
    });
  });
  const applicableRequired = results.filter(
    (result) =>
      result.account.requiredForClose && result.status !== "not_applicable",
  );
  const completeAccountCount = applicableRequired.filter(
    (result) => result.status === "complete",
  ).length;

  return {
    targetMonth,
    monthEnd: month.end,
    requiredAccountCount: applicableRequired.length,
    completeAccountCount,
    blockedAccountCount: applicableRequired.length - completeAccountCount,
    isCoverageComplete: applicableRequired.length === completeAccountCount,
    accounts: results,
  };
}
