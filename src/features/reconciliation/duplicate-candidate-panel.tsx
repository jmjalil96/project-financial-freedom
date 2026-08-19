"use client";

import { Link2Off } from "lucide-react";

import { formatCalendarDate } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import { dismissDuplicateCandidateAction } from "@/features/reconciliation/actions";
import type { DuplicateCandidateView } from "@/features/reconciliation/review-service";

const matchKindLabels: Record<DuplicateCandidateView["matchKind"], string> = {
  external_id: "Matching external ID",
  signature: "Matching row signature",
  statement_overlap: "Overlapping statement evidence",
};

function DismissCandidateForm({
  candidate,
  disabled,
}: {
  candidate: DuplicateCandidateView;
  disabled: boolean;
}) {
  const { state, onSubmit, isPending } = usePreservingActionState<FormActionState>(
    dismissDuplicateCandidateAction,
    initialFormActionState,
  );

  return (
    <div className="duplicate-candidate__action">
      <form onSubmit={onSubmit}>
        <input name="candidateId" type="hidden" value={candidate.id} />
        <button
          aria-label={`Dismiss duplicate candidate row ${candidate.candidate.originalRowNumber}`}
          className="quiet-button"
          disabled={disabled || isPending}
          type="submit"
        >
          <Link2Off aria-hidden="true" size={13} />
          {isPending ? "Dismissing…" : "Not a duplicate"}
        </button>
      </form>
      {state.status !== "idle" ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function DuplicateCandidatePanel({
  candidates,
  finalized,
}: {
  candidates: readonly DuplicateCandidateView[];
  finalized: boolean;
}) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <section aria-label="Duplicate candidate evidence" className="duplicate-panel">
      <div className="duplicate-panel__heading">
        <h4>Duplicate comparison</h4>
        <span>
          {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="duplicate-panel__list">
        {candidates.map((candidate) => (
          <article className="duplicate-candidate" key={candidate.id}>
            <div className="duplicate-candidate__meta">
              <span data-strength={candidate.strength}>{candidate.strength} match</span>
              <span>{candidate.status}</span>
            </div>
            <div className="duplicate-candidate__identity">
              <strong>{candidate.candidate.description}</strong>
              <span>
                {candidate.candidate.accountName} · import #
                {candidate.candidate.importBatchId} row{" "}
                {candidate.candidate.originalRowNumber}
              </span>
            </div>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{formatCalendarDate(candidate.candidate.transactionDate)}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {formatMoney(
                    candidate.candidate.amountMinor,
                    candidate.candidate.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>{matchKindLabels[candidate.matchKind]}</dd>
              </div>
            </dl>
            {candidate.status === "open" ? (
              <DismissCandidateForm candidate={candidate} disabled={finalized} />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
