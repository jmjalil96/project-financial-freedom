import { CheckCircle2, GitCompareArrows, ShieldAlert } from "lucide-react";

import { formatMoney } from "@/domain/money";
import type { StatementReconciliation } from "@/features/reconciliation/reconciliation-service";

export function ReconciliationPanel({
  statement,
}: {
  statement: StatementReconciliation;
}) {
  const { reconciliation } = statement;
  const balanced = reconciliation.differenceMinor === 0;
  const counts = statement.rows.reduce(
    (result, row) => {
      const disposition = row.decision.disposition;
      if (disposition) {
        result[disposition] += 1;
      } else {
        result.unresolved += 1;
      }
      return result;
    },
    { accepted: 0, excluded: 0, duplicate: 0, unresolved: 0 },
  );

  return (
    <section
      aria-labelledby="reconciliation-title"
      className="reconciliation-panel"
      data-balanced={balanced}
    >
      <header className="reconciliation-panel__header">
        <div>
          <p className="card-kicker">Statement control account</p>
          <h2 id="reconciliation-title">Reconciliation equation</h2>
          <p>
            Every figure below is traced directly to source rows and saved decisions.
            Amounts use the account&apos;s ledger sign.
          </p>
        </div>
        <span className={balanced ? "balance-seal" : "balance-seal balance-seal--open"}>
          {balanced ? (
            <CheckCircle2 aria-hidden="true" size={16} />
          ) : (
            <GitCompareArrows aria-hidden="true" size={16} />
          )}
          {balanced ? "Balanced" : "Difference open"}
        </span>
      </header>

      <ol className="reconciliation-trace">
        <li>
          <span>01 · Source evidence</span>
          <strong>
            {formatMoney(
              reconciliation.sourceActivityTotalMinor,
              statement.batch.currency,
            )}
          </strong>
          <small>{statement.rows.length} immutable rows</small>
        </li>
        <li>
          <span>02 · Provisional</span>
          <strong>
            {formatMoney(
              reconciliation.provisionalActivityTotalMinor,
              statement.batch.currency,
            )}
          </strong>
          <small>
            Before {counts.excluded} excluded and {counts.duplicate} duplicate
          </small>
        </li>
        <li data-current="true">
          <span>03 · Accepted</span>
          <strong>
            {formatMoney(
              reconciliation.acceptedActivityTotalMinor,
              statement.batch.currency,
            )}
          </strong>
          <small>
            {counts.accepted} accepted · {counts.unresolved} unresolved
          </small>
        </li>
      </ol>

      <div className="reconciliation-equation" aria-label="Reconciliation calculation">
        <div>
          <span>Opening ledger balance</span>
          <strong>
            {formatMoney(reconciliation.openingBalanceMinor, statement.batch.currency)}
          </strong>
        </div>
        <span className="reconciliation-equation__operator" aria-hidden="true">
          +
        </span>
        <div>
          <span>Accepted activity</span>
          <strong>
            {formatMoney(
              reconciliation.acceptedActivityTotalMinor,
              statement.batch.currency,
            )}
          </strong>
        </div>
        <span className="reconciliation-equation__operator" aria-hidden="true">
          =
        </span>
        <div>
          <span>Expected closing</span>
          <strong>
            {formatMoney(
              reconciliation.expectedClosingBalanceMinor,
              statement.batch.currency,
            )}
          </strong>
        </div>
        <span className="reconciliation-equation__comparison" aria-hidden="true">
          vs
        </span>
        <div>
          <span>Statement closing</span>
          <strong>
            {formatMoney(reconciliation.closingBalanceMinor, statement.batch.currency)}
          </strong>
        </div>
      </div>

      <div className="reconciliation-difference">
        <span>Closing − expected closing</span>
        <strong>
          {formatMoney(reconciliation.differenceMinor, statement.batch.currency)}
        </strong>
        <small>
          {balanced ? "Exact reconciliation" : "Must equal zero to finalize"}
        </small>
      </div>

      {statement.batchBlockers.length > 0 ? (
        <section className="statement-blockers">
          <div>
            <ShieldAlert aria-hidden="true" size={16} />
            <h3>Finalization blockers</h3>
          </div>
          <ul>
            {statement.batchBlockers.map((blocker) => (
              <li key={blocker.code}>
                <span>{blocker.code.replaceAll("_", " ")}</span>
                {blocker.message}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="statement-ready">
          <CheckCircle2 aria-hidden="true" size={15} />
          The equation and row evidence are ready for finalization.
        </p>
      )}
    </section>
  );
}
