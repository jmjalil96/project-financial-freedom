import { FileUp } from "lucide-react";
import type { Metadata } from "next";

import { getPaginationState } from "@/domain/pagination";
import { listFinancialAccounts } from "@/features/accounts/account-service";
import { listCategories } from "@/features/categories/category-service";
import { ImportHistory } from "@/features/imports/import-history";
import {
  countImportBatches,
  listImportHistory,
} from "@/features/imports/import-service";
import { ImportWorkspace } from "@/features/imports/import-workspace";
import { getApplicationSettings } from "@/features/settings/settings-repository";

export const metadata: Metadata = {
  title: "Imports",
};

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const pageSize = 50;
  const totalBatches = await countImportBatches();
  const { currentPage, totalPages, offset } = getPaginationState(
    (await searchParams).page,
    totalBatches,
    pageSize,
  );
  const [accounts, categories, history, settings] = await Promise.all([
    listFinancialAccounts(),
    listCategories(),
    listImportHistory(pageSize, offset),
    getApplicationSettings(),
  ]);

  if (!settings) {
    return null;
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Untrusted input · deliberate commit</p>
          <h1>CSV imports</h1>
          <p>
            Validate every source row in memory, inspect the complete preview, then
            commit the batch atomically without storing the uploaded file.
          </p>
        </div>
        <div className="heading-stat">
          <span>Committed batches</span>
          <strong>{totalBatches}</strong>
          <small>
            CSV contract v1 · page {currentPage} of {totalPages}
          </small>
        </div>
      </section>

      <ImportWorkspace
        accounts={accounts}
        baseCurrency={settings.baseCurrency}
        categoryNames={categories
          .filter((category) => !category.archivedAt)
          .map((category) => category.name)}
      />

      <ImportHistory
        currentPage={currentPage}
        history={history}
        totalPages={totalPages}
      />

      <section className="import-principle">
        <FileUp aria-hidden="true" size={18} />
        <p>
          A committed import stores normalized source evidence only. It does not create
          ledger postings until the review phase.
        </p>
      </section>
    </>
  );
}
