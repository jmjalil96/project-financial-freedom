"use client";

import { LockKeyhole, ReceiptText, ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";

import { formatMoney } from "@/domain/money";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import {
  finalizeImportBatchAction,
  postFinalizedImportBatchAction,
} from "@/features/reconciliation/actions";
import type { StatementReconciliation } from "@/features/reconciliation/reconciliation-service";

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string): string {
  const utcValue = value.includes("T")
    ? value.endsWith("Z")
      ? value
      : `${value}Z`
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(utcValue);
  return Number.isNaN(date.getTime()) ? value : timestampFormatter.format(date);
}

export function FinalizeForm({
  batchId,
  blockerCount,
}: {
  batchId: number;
  blockerCount: number;
}) {
  const { state, onSubmit, isPending } = usePreservingActionState<FormActionState>(
    finalizeImportBatchAction,
    initialFormActionState,
  );
  const ready = blockerCount === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (
      !window.confirm(
        "Finalize and post this statement? Saved evidence and decisions will become read only, and accepted rows will enter the ledger.",
      )
    ) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  }

  return (
    <section aria-labelledby="finalize-title" className="finalize-form">
      <div className="finalize-form__copy">
        <span>
          <LockKeyhole aria-hidden="true" size={18} />
        </span>
        <div>
          <p className="card-kicker">Irreversible review seal</p>
          <h2 id="finalize-title">Finalize statement</h2>
          <p>
            Finalization seals every source row and decision, then posts every accepted
            row as a balanced, traceable ledger entry in the same transaction.
          </p>
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <input name="importBatchId" type="hidden" value={batchId} />
        <button className="primary-button" disabled={!ready || isPending} type="submit">
          <ShieldCheck aria-hidden="true" size={16} />
          {isPending ? "Finalizing statement…" : "Finalize reconciled statement"}
        </button>
        {!ready ? (
          <p>
            Resolve {blockerCount}{" "}
            {blockerCount === 1 ? "finalization blocker" : "finalization blockers"}{" "}
            before sealing this statement.
          </p>
        ) : (
          <p>
            All checks pass. Finalization will post accepted rows and keep excluded or
            duplicate evidence out of the ledger.
          </p>
        )}
      </form>
      {state.status !== "idle" ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

function LegacyPostingForm({ batchId }: { batchId: number }) {
  const { state, onSubmit, isPending } = usePreservingActionState<FormActionState>(
    postFinalizedImportBatchAction,
    initialFormActionState,
  );

  return (
    <form className="finalize-receipt__legacy" onSubmit={onSubmit}>
      <input name="importBatchId" type="hidden" value={batchId} />
      <p>
        This statement was finalized before ledger posting was introduced. Post its
        accepted rows now to complete the Phase 5 record.
      </p>
      <button className="primary-button" disabled={isPending} type="submit">
        {isPending ? "Posting accepted rows…" : "Post finalized statement"}
      </button>
      {state.status !== "idle" ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function FinalizeReceipt({ statement }: { statement: StatementReconciliation }) {
  const counts = statement.rows.reduce(
    (result, row) => {
      const disposition = row.decision.disposition;
      if (disposition) {
        result[disposition] += 1;
      }
      return result;
    },
    { accepted: 0, excluded: 0, duplicate: 0 },
  );

  return (
    <section aria-labelledby="receipt-title" className="finalize-receipt">
      <div className="finalize-receipt__mark">
        <ReceiptText aria-hidden="true" size={21} />
      </div>
      <div className="finalize-receipt__copy">
        <p className="card-kicker">Finalization receipt</p>
        <h2 id="receipt-title">
          {statement.batch.ledgerPostedAt
            ? "Statement sealed and posted"
            : "Statement sealed"}
        </h2>
        <p>
          Finalized{" "}
          {statement.batch.finalizedAt
            ? formatTimestamp(statement.batch.finalizedAt)
            : "with a recorded audit event"}
          . The source evidence and review decisions are now read only.
          {statement.batch.ledgerPostedAt
            ? " Every accepted row is linked to its posted journal entry."
            : ""}
        </p>
      </div>
      <dl>
        <div>
          <dt>Accepted</dt>
          <dd>{counts.accepted}</dd>
        </div>
        <div>
          <dt>Excluded</dt>
          <dd>{counts.excluded}</dd>
        </div>
        <div>
          <dt>Duplicates</dt>
          <dd>{counts.duplicate}</dd>
        </div>
        <div>
          <dt>Accepted activity</dt>
          <dd>
            {formatMoney(
              statement.reconciliation.acceptedActivityTotalMinor,
              statement.batch.currency,
            )}
          </dd>
        </div>
        <div>
          <dt>Difference</dt>
          <dd>
            {formatMoney(
              statement.reconciliation.differenceMinor,
              statement.batch.currency,
            )}
          </dd>
        </div>
      </dl>
      {!statement.batch.ledgerPostedAt ? (
        <LegacyPostingForm batchId={statement.batch.id} />
      ) : null}
    </section>
  );
}
