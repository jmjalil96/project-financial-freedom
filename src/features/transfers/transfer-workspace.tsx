"use client";

import { ArrowLeftRight, CircleCheck, Clock3, Route } from "lucide-react";

import { formatCalendarDate } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import {
  classifyTransferAction,
  clearTransferClassificationAction,
  confirmTransferMatchAction,
} from "@/features/transfers/actions";
import type { TransferWorkspaceRow } from "@/features/transfers/transfer-service";

const labels = {
  owned_account: "Owned-account transfer",
  card_payment: "Card or loan payment",
  external_out: "Sent to an owned account not tracked here",
  external_in: "Received from an owned account not tracked here",
  in_transit: "Still in transit",
} as const;

function ActionMessage({ state }: { state: FormActionState }) {
  return state.status === "idle" ? null : (
    <p
      className={`form-message form-message--${state.status}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function TransferResolutionCard({ row }: { row: TransferWorkspaceRow }) {
  const classification = usePreservingActionState<FormActionState>(
    classifyTransferAction,
    initialFormActionState,
  );
  const match = usePreservingActionState<FormActionState>(
    confirmTransferMatchAction,
    initialFormActionState,
  );
  const clear = usePreservingActionState<FormActionState>(
    clearTransferClassificationAction,
    initialFormActionState,
  );
  const externalClassification = row.amountMinor < 0 ? "external_out" : "external_in";

  return (
    <article className="transfer-ledger-row" data-resolved={Boolean(row.resolution)}>
      <div className="transfer-ledger-row__evidence">
        <div className="transfer-ledger-row__line">
          <span>
            Import #{row.importBatchId} · row {row.originalRowNumber}
          </span>
          <span>{formatCalendarDate(row.transactionDate)}</span>
        </div>
        <h2>{row.description}</h2>
        <div className="transfer-ledger-row__account">
          <span>{row.accountName}</span>
          <strong data-sign={row.amountMinor < 0 ? "negative" : "positive"}>
            {formatMoney(row.amountMinor, row.currency)}
          </strong>
        </div>
        <p>
          Effective {formatCalendarDate(row.effectiveDate)}
          {row.postedDate ? ` · posted ${formatCalendarDate(row.postedDate)}` : ""}
        </p>
      </div>

      <div className="transfer-ledger-row__resolution">
        {row.resolution ? (
          <>
            <div className="transfer-resolution-state">
              <CircleCheck aria-hidden="true" size={18} />
              <div>
                <span>Resolved</span>
                <strong>{labels[row.resolution.classification]}</strong>
                {row.resolution.counterpartAccountName ? (
                  <p>
                    Matched with {row.resolution.counterpartAccountName} —{" "}
                    {row.resolution.counterpartDescription}
                  </p>
                ) : null}
                {row.resolution.manualItemName ? (
                  <p>Represented by the {row.resolution.manualItemName} valuation.</p>
                ) : null}
              </div>
            </div>
            <form onSubmit={clear.onSubmit}>
              <input name="importRowId" type="hidden" value={row.id} />
              <button className="text-button" disabled={clear.isPending} type="submit">
                {clear.isPending ? "Clearing…" : "Change resolution"}
              </button>
              <ActionMessage state={clear.state} />
            </form>
          </>
        ) : (
          <div className="transfer-resolution-options">
            {row.candidates.length > 0 ? (
              <form onSubmit={match.onSubmit}>
                <label htmlFor={`counterpart-${row.id}`}>
                  Match an owned-account leg
                </label>
                <div className="transfer-resolution-options__controls">
                  <select
                    defaultValue=""
                    id={`counterpart-${row.id}`}
                    name="counterpartImportRowId"
                    required
                  >
                    <option disabled value="">
                      Choose equal and opposite activity
                    </option>
                    {row.candidates.map((candidate) => (
                      <option
                        key={candidate.candidateImportRowId}
                        value={candidate.candidateImportRowId}
                      >
                        {candidate.accountName} ·{" "}
                        {formatMoney(candidate.amountMinor, row.currency)} ·{" "}
                        {formatCalendarDate(candidate.transactionDate)}
                      </option>
                    ))}
                  </select>
                  <input name="importRowId" type="hidden" value={row.id} />
                  <button
                    className="secondary-button"
                    disabled={match.isPending}
                    type="submit"
                  >
                    <ArrowLeftRight aria-hidden="true" size={15} />
                    {match.isPending ? "Matching…" : "Confirm match"}
                  </button>
                </div>
                <ActionMessage state={match.state} />
              </form>
            ) : (
              <p className="transfer-resolution-options__empty">
                No equal-and-opposite owned-account leg is ready within three days.
              </p>
            )}
            <form onSubmit={classification.onSubmit}>
              <label htmlFor={`classification-${row.id}`}>
                Explain an unmatched transfer
              </label>
              <div className="transfer-resolution-options__controls">
                <select
                  defaultValue=""
                  id={`classification-${row.id}`}
                  name="classification"
                  required
                >
                  <option disabled value="">
                    Choose a classification
                  </option>
                  <option value={externalClassification}>
                    {labels[externalClassification]}
                  </option>
                  <option value="in_transit">{labels.in_transit}</option>
                </select>
                <input name="importRowId" type="hidden" value={row.id} />
                <button
                  className="secondary-button"
                  disabled={classification.isPending}
                  type="submit"
                >
                  <Route aria-hidden="true" size={15} />
                  {classification.isPending ? "Saving…" : "Save explanation"}
                </button>
              </div>
              <ActionMessage state={classification.state} />
            </form>
          </div>
        )}
      </div>
    </article>
  );
}

export function TransferWorkspace({
  clearingBalanceMinor,
  outsideScopeBalanceMinor,
  rows,
}: {
  clearingBalanceMinor: number;
  outsideScopeBalanceMinor: number;
  rows: TransferWorkspaceRow[];
}) {
  const unresolved = rows.filter((row) => !row.resolution).length;
  const currency = rows[0]?.currency;

  return (
    <main className="transfer-workspace">
      <header className="transfer-workspace__hero">
        <div>
          <p className="eyebrow">Transfer clearing desk</p>
          <h1>Explain every movement between accounts.</h1>
          <p>
            Imported transfer legs post independently through clearing. Match owned
            accounts, leave timing differences in transit, or move transfers to owned
            accounts outside this workspace into their own visible balance. Money that
            changes ownership belongs in income, expense, refund, or adjustment—not as
            an external transfer.
          </p>
        </div>
        <div className="transfer-clearing-tally">
          <Clock3 aria-hidden="true" size={18} />
          <span>Unexplained legs</span>
          <strong>{unresolved}</strong>
          <span>Clearing balance</span>
          <strong>
            {currency ? formatMoney(clearingBalanceMinor, currency) : "No ledger yet"}
          </strong>
          <span>Outside-scope balance</span>
          <strong>
            {currency
              ? formatMoney(outsideScopeBalanceMinor, currency)
              : "No ledger yet"}
          </strong>
        </div>
      </header>

      {rows.length === 0 ? (
        <section className="transfer-workspace__empty">
          <ArrowLeftRight aria-hidden="true" size={24} />
          <h2>No accepted transfers yet</h2>
          <p>
            Review imported rows and confirm transfer types. They will appear here for
            matching and classification.
          </p>
        </section>
      ) : (
        <section aria-label="Accepted transfer rows" className="transfer-ledger">
          {rows.map((row) => (
            <TransferResolutionCard key={row.id} row={row} />
          ))}
        </section>
      )}
    </main>
  );
}
