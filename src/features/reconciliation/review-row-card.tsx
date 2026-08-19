import { ArrowLeftRight, CalendarDays, FileText, ShieldAlert } from "lucide-react";

import { formatCalendarDate } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import { DecisionForm } from "@/features/reconciliation/decision-form";
import { DuplicateCandidatePanel } from "@/features/reconciliation/duplicate-candidate-panel";
import type {
  ReviewCategory,
  ReviewRowView,
} from "@/features/reconciliation/review-service";

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

export function ReviewRowCard({
  categories,
  row,
}: {
  categories: readonly ReviewCategory[];
  row: ReviewRowView;
}) {
  const finalized = row.batch.reviewStatus === "finalized";
  const disposition = row.decision.disposition;
  const statusLabel =
    disposition === null
      ? `${row.blockers.length} ${row.blockers.length === 1 ? "blocker" : "blockers"}`
      : disposition;

  return (
    <article
      className="review-row-card"
      data-finalized={finalized}
      id={`review-row-${row.id}`}
    >
      <header className="review-row-card__header">
        <div className="review-row-card__statement">
          <span className="review-row-card__row-number">
            <FileText aria-hidden="true" size={14} />
            Source row {row.originalRowNumber}
          </span>
          <span>{row.account.name}</span>
          <span>Import #{row.batch.id}</span>
          <span>{row.batch.sourceFilename}</span>
        </div>
        <span
          className={
            disposition === "accepted"
              ? "row-decision-state row-decision-state--accepted"
              : disposition
                ? "row-decision-state"
                : "row-decision-state row-decision-state--blocked"
          }
        >
          {statusLabel}
        </span>
      </header>

      <div className="review-row-card__body">
        <div className="source-evidence">
          <div className="source-evidence__heading">
            <div>
              <p className="card-kicker">Immutable source evidence</p>
              <h3>{row.description}</h3>
            </div>
            <strong data-sign={row.amountMinor < 0 ? "negative" : "positive"}>
              {formatMoney(row.amountMinor, row.currency)}
            </strong>
          </div>

          <div className="source-evidence__dates">
            <CalendarDays aria-hidden="true" size={15} />
            <dl>
              <div>
                <dt>Transaction</dt>
                <dd>{formatCalendarDate(row.transactionDate)}</dd>
              </div>
              <div>
                <dt>Posted</dt>
                <dd>
                  {row.postedDate ? formatCalendarDate(row.postedDate) : "Not provided"}
                </dd>
              </div>
              <div>
                <dt>Source effective</dt>
                <dd>{formatCalendarDate(row.defaultEffectiveDate)}</dd>
              </div>
            </dl>
          </div>

          <dl className="source-evidence__facts">
            <div>
              <dt>Merchant</dt>
              <dd>{row.merchant ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>External ID</dt>
              <dd>{row.externalId ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Suggested type</dt>
              <dd>{row.suggestedType ? humanize(row.suggestedType) : "Unresolved"}</dd>
            </div>
            <div>
              <dt>Suggested category</dt>
              <dd>{row.suggestedCategory ?? "Unresolved"}</dd>
            </div>
            <div>
              <dt>Source notes</dt>
              <dd>{row.notes ?? "Not provided"}</dd>
            </div>
          </dl>

          {row.warnings.length > 0 || row.blockers.length > 0 ? (
            <section className="row-evidence-alerts">
              <div>
                <ShieldAlert aria-hidden="true" size={14} />
                <h4>Evidence requiring attention</h4>
              </div>
              <ul>
                {row.warnings.map((warning, index) => (
                  <li key={`warning-${warning.code}-${index}`}>
                    <span>{humanize(warning.code)}</span>
                    {warning.message ?? "Review this source warning before finalizing."}
                  </li>
                ))}
                {row.blockers.map((blocker, index) => (
                  <li key={`blocker-${blocker.code}-${index}`}>
                    <span>{humanize(blocker.code)}</span>
                    {blocker.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="row-evidence-clear">No row-level blockers remain.</p>
          )}

          {row.transferCandidates.length > 0 ? (
            <section className="transfer-candidates">
              <div>
                <ArrowLeftRight aria-hidden="true" size={14} />
                <h4>Possible transfer counterpart</h4>
              </div>
              <ul>
                {row.transferCandidates.map((candidate) => (
                  <li key={candidate.candidateImportRowId}>
                    <div>
                      <strong>{candidate.description}</strong>
                      <span>
                        {candidate.accountName} ·{" "}
                        {formatCalendarDate(candidate.transactionDate)} ·{" "}
                        {candidate.daysApart}{" "}
                        {candidate.daysApart === 1 ? "day" : "days"} apart
                      </span>
                    </div>
                    <strong>{formatMoney(candidate.amountMinor, row.currency)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <DuplicateCandidatePanel
            candidates={row.duplicateCandidates}
            finalized={finalized}
          />
        </div>

        <DecisionForm categories={categories} finalized={finalized} row={row} />
      </div>
    </article>
  );
}
