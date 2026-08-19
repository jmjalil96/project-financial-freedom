import { ArrowLeft, FileCheck2, Rows3 } from "lucide-react";
import Link from "next/link";

import { formatCalendarDate } from "@/domain/calendar-date";
import { FinalizeForm, FinalizeReceipt } from "@/features/reconciliation/finalize-form";
import { ReconciliationPanel } from "@/features/reconciliation/reconciliation-panel";
import type { StatementReconciliation } from "@/features/reconciliation/reconciliation-service";
import { ReviewRowCard } from "@/features/reconciliation/review-row-card";
import type {
  ReviewCategory,
  ReviewRowView,
} from "@/features/reconciliation/review-service";

export function StatementReviewWorkspace({
  categories,
  rows,
  statement,
}: {
  categories: readonly ReviewCategory[];
  rows: readonly ReviewRowView[];
  statement: StatementReconciliation;
}) {
  const finalized = statement.batch.reviewStatus === "finalized";

  return (
    <>
      <div className="statement-workspace__back">
        <Link className="text-link" href="/imports">
          <ArrowLeft aria-hidden="true" size={13} />
          Import history
        </Link>
        <Link className="text-link" href="/review">
          Global review inbox
        </Link>
      </div>

      <section className="page-heading statement-workspace__heading">
        <div>
          <p className="eyebrow">Statement review · import #{statement.batch.id}</p>
          <h1>{statement.account.name}</h1>
          <p>
            {statement.batch.sourceFilename} ·{" "}
            {formatCalendarDate(statement.batch.statementStartDate)} to{" "}
            {formatCalendarDate(statement.batch.statementEndDate)}. Compare immutable
            evidence with the editable decision overlay, then seal the exact ledger
            equation.
          </p>
        </div>
        <div className="statement-status">
          <span
            className={
              finalized
                ? "status-badge status-badge--success"
                : "status-badge status-badge--warning"
            }
          >
            <FileCheck2 aria-hidden="true" size={13} />
            {statement.batch.reviewStatus.replace("_", " ")}
          </span>
          <small>
            {statement.batch.rowCount} source{" "}
            {statement.batch.rowCount === 1 ? "row" : "rows"} ·{" "}
            {statement.batch.warningCount} source{" "}
            {statement.batch.warningCount === 1 ? "warning" : "warnings"}
          </small>
        </div>
      </section>

      <ReconciliationPanel statement={statement} />

      {finalized ? (
        <FinalizeReceipt statement={statement} />
      ) : (
        <FinalizeForm
          batchId={statement.batch.id}
          blockerCount={statement.batchBlockers.length}
        />
      )}

      <section aria-labelledby="statement-rows-title" className="statement-row-ledger">
        <div className="statement-row-ledger__heading">
          <div>
            <p className="card-kicker">Line-by-line trace</p>
            <h2 id="statement-rows-title">Statement rows</h2>
            <p>
              Source evidence remains visible beside the decision that controls the
              accepted activity total.
            </p>
          </div>
          <span>
            <Rows3 aria-hidden="true" size={16} />
            {rows.length} rows
          </span>
        </div>
        <div className="statement-row-ledger__rows">
          {rows.map((row) => (
            <ReviewRowCard categories={categories} key={row.id} row={row} />
          ))}
        </div>
      </section>
    </>
  );
}
