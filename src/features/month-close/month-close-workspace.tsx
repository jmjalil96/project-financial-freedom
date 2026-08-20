"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarCheck2,
  CircleAlert,
  FileCheck2,
  History,
  Landmark,
  LockKeyhole,
  RotateCcw,
  Scale,
  Tags,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { formatCalendarDate } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import { formatSavingsRate } from "@/domain/monthly-report";
import {
  initialFormActionState,
  type FormActionState,
} from "@/features/forms/action-state";
import { usePreservingActionState } from "@/features/forms/use-preserving-action-state";
import { closeMonthAction, reopenMonthAction } from "@/features/month-close/actions";
import type {
  MonthCloseWorkspaceView,
  MonthCloseBlocker,
} from "@/features/month-close/month-close-service";
import type { ReportSource } from "@/features/reports/monthly-report-service";

function ActionMessage({ state }: { state: FormActionState }) {
  return state.status === "idle" ? null : (
    <p
      className={"form-message form-message--" + state.status}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function SourceList({
  sources,
  currency,
  emptyMessage,
}: {
  sources: ReportSource[];
  currency: MonthCloseWorkspaceView["report"]["currency"];
  emptyMessage: string;
}) {
  if (sources.length === 0) {
    return <p className="report-source-empty">{emptyMessage}</p>;
  }
  return (
    <ol className="report-source-list">
      {sources.map((source, index) => (
        <li key={source.journalEntryId + "-" + index}>
          <div>
            <span>{formatCalendarDate(source.effectiveDate)}</span>
            <strong>{source.description}</strong>
            <small>
              Journal #{source.journalEntryId}
              {source.importSource
                ? " · " +
                  source.importSource.sourceFilename +
                  " row " +
                  source.importSource.originalRowNumber
                : " · " + source.sourceType + " evidence"}
              {source.reversesEntryId ? " · reverses #" + source.reversesEntryId : ""}
            </small>
          </div>
          <strong data-negative={source.amountMinor < 0}>
            {formatMoney(source.amountMinor, currency)}
          </strong>
        </li>
      ))}
    </ol>
  );
}

function CloseForm({ workspace }: { workspace: MonthCloseWorkspaceView }) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    closeMonthAction,
    initialFormActionState,
  );
  return (
    <form className="month-close-confirmation" onSubmit={onSubmit}>
      <input name="targetMonth" type="hidden" value={workspace.targetMonth} />
      <label className="checkbox-field">
        <input name="confirmed" type="checkbox" />
        <span>
          I reviewed the report, source evidence, and{" "}
          {workspace.readiness.warnings.length} nonblocking acknowledgment
          {workspace.readiness.warnings.length === 1 ? "" : "s"}.
        </span>
      </label>
      <button className="primary-button" disabled={isPending} type="submit">
        <LockKeyhole aria-hidden="true" size={16} />
        {isPending ? "Closing…" : "Close month"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function ReopenForm({ workspace }: { workspace: MonthCloseWorkspaceView }) {
  const { state, onSubmit, isPending } = usePreservingActionState(
    reopenMonthAction,
    initialFormActionState,
  );
  return (
    <form className="month-reopen-form" onSubmit={onSubmit}>
      <input name="targetMonth" type="hidden" value={workspace.targetMonth} />
      <label>
        <span>Reason for reopening</span>
        <textarea
          maxLength={500}
          name="reason"
          placeholder="Describe the late evidence or correction…"
          required
          rows={2}
        />
      </label>
      <button
        className="danger-button"
        disabled={isPending}
        onClick={(event) => {
          if (
            !window.confirm(
              "Reopen this month and make it and every later closed month provisional?",
            )
          ) {
            event.preventDefault();
          }
        }}
        type="submit"
      >
        <RotateCcw aria-hidden="true" size={15} />
        {isPending ? "Reopening…" : "Reopen month"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function BlockerCard({ blocker }: { blocker: MonthCloseBlocker }) {
  return (
    <article>
      <CircleAlert aria-hidden="true" size={18} />
      <div>
        <span>{blocker.group}</span>
        <strong>{blocker.title}</strong>
        <p>{blocker.message}</p>
      </div>
      <Link className="text-link" href={blocker.href}>
        Resolve
      </Link>
    </article>
  );
}

const statusLabels = {
  provisional: "Provisional",
  ready: "Ready to close",
  closed: "Closed",
  reopened: "Reopened",
  historical: "Historical revision",
} as const;

export function MonthCloseWorkspace({
  workspace,
}: {
  workspace: MonthCloseWorkspaceView;
}) {
  const { report, readiness } = workspace;
  const changePositive = report.netWorth.changeMinor >= 0;
  const canReopen =
    workspace.state === "closed" &&
    workspace.selectedRevision?.id === workspace.activeRevisionId;
  return (
    <main className="month-close-workspace">
      <header className="month-close-hero" data-state={workspace.state}>
        <div>
          <p className="eyebrow">Calendar-month review</p>
          <h1>{workspace.targetMonth} financial close</h1>
          <p>
            {workspace.state === "closed" || workspace.state === "historical"
              ? "This report is rendered from the preserved close revision, not recalculated live data."
              : "Readiness is calculated from finalized coverage, reviewed transactions, transfer explanations, and dated valuations."}
          </p>
        </div>
        <div className="month-close-hero__controls">
          <span className={"month-state-badge month-state-badge--" + workspace.state}>
            {workspace.state === "closed" ? (
              <BadgeCheck aria-hidden="true" size={15} />
            ) : workspace.state === "historical" ? (
              <History aria-hidden="true" size={15} />
            ) : (
              <CalendarCheck2 aria-hidden="true" size={15} />
            )}
            {statusLabels[workspace.state]}
          </span>
          <form action="/month-close" className="coverage-month-form" method="get">
            <label htmlFor="close-month">Target month</label>
            <input
              defaultValue={workspace.targetMonth}
              id="close-month"
              name="month"
              type="month"
            />
            <button className="primary-button" type="submit">
              Review month
            </button>
          </form>
        </div>
      </header>

      {workspace.revisions.length > 0 ? (
        <nav className="close-revision-nav" aria-label="Close revisions">
          <div>
            <History aria-hidden="true" size={16} />
            <strong>Revision history</strong>
          </div>
          <Link
            data-active={workspace.selectedRevision === null}
            href={"/month-close?month=" + workspace.targetMonth}
          >
            Live state
          </Link>
          {workspace.revisions.map((revision) => (
            <Link
              data-active={workspace.selectedRevision?.id === revision.id}
              href={
                "/month-close?month=" +
                workspace.targetMonth +
                "&revision=" +
                revision.id
              }
              key={revision.id}
            >
              Revision {revision.revisionNumber}
              {revision.id === workspace.activeRevisionId ? " · active" : ""}
            </Link>
          ))}
        </nav>
      ) : null}

      <section className="close-readiness-panel">
        <div className="close-readiness-panel__summary">
          <div>
            {readiness.isReady ? (
              <BookOpenCheck aria-hidden="true" size={24} />
            ) : (
              <AlertTriangle aria-hidden="true" size={24} />
            )}
            <div>
              <p className="card-kicker">Closing readiness</p>
              <h2>
                {workspace.state === "closed" || workspace.state === "historical"
                  ? "Revision evidence preserved"
                  : readiness.isReady
                    ? "Every blocking gate passes"
                    : readiness.blockers.length +
                      " blocker" +
                      (readiness.blockers.length === 1 ? "" : "s") +
                      " remain"}
              </h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>Required coverage</dt>
              <dd>
                {readiness.coverage.completeAccountCount}/
                {readiness.coverage.requiredAccountCount}
              </dd>
            </div>
            <div>
              <dt>Statements included</dt>
              <dd>{readiness.includedStatements.length}</dd>
            </div>
            <div>
              <dt>Acknowledgments</dt>
              <dd>{readiness.warnings.length}</dd>
            </div>
          </dl>
        </div>
        {readiness.blockers.length > 0 ? (
          <div className="close-blocker-list">
            {readiness.blockers.map((blocker, index) => (
              <BlockerCard blocker={blocker} key={blocker.code + "-" + index} />
            ))}
          </div>
        ) : null}
        {readiness.warnings.length > 0 ? (
          <details className="close-warning-list">
            <summary>
              Review {readiness.warnings.length} nonblocking acknowledgment
              {readiness.warnings.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {readiness.warnings.map((warning, index) => (
                <li key={warning.code + "-" + index}>
                  <span>{warning.message}</span>
                  <Link href={warning.href}>Inspect</Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {readiness.isReady &&
        workspace.state !== "closed" &&
        workspace.state !== "historical" ? (
          <CloseForm workspace={workspace} />
        ) : null}
        {canReopen ? <ReopenForm workspace={workspace} /> : null}
      </section>

      <section className="monthly-report-summary" aria-label="Monthly report summary">
        <article>
          <span>Income</span>
          <strong>{formatMoney(report.incomeMinor, report.currency)}</strong>
          <details>
            <summary>Trace {report.incomeSources.length} source entries</summary>
            <SourceList
              currency={report.currency}
              emptyMessage="No income postings in this month."
              sources={report.incomeSources}
            />
          </details>
        </article>
        <article>
          <span>Expenses</span>
          <strong>{formatMoney(report.expensesMinor, report.currency)}</strong>
          <details>
            <summary>Trace {report.expenseSources.length} source entries</summary>
            <SourceList
              currency={report.currency}
              emptyMessage="No expense postings in this month."
              sources={report.expenseSources}
            />
          </details>
        </article>
        <article>
          <span>Savings</span>
          <strong>{formatMoney(report.savingsMinor, report.currency)}</strong>
          <small>{formatSavingsRate(report.savingsRateBasisPoints)} savings rate</small>
          <details>
            <summary>Trace calculation</summary>
            <p className="report-calculation-note">
              Income minus expenses. The rate divides that result by income; it is
              unavailable when income is zero or negative.
            </p>
            <h3>Income sources</h3>
            <SourceList
              currency={report.currency}
              emptyMessage="No income postings in this month."
              sources={report.incomeSources}
            />
            <h3>Expense sources</h3>
            <SourceList
              currency={report.currency}
              emptyMessage="No expense postings in this month."
              sources={report.expenseSources}
            />
          </details>
        </article>
        <article>
          <span>Budget planned</span>
          <strong>{formatMoney(report.budgetPlannedMinor, report.currency)}</strong>
          <small>
            {formatMoney(report.budgetRemainingMinor, report.currency)} remaining
          </small>
          <details>
            <summary>Trace category targets</summary>
            <ul className="report-budget-source-list">
              {report.expenseCategories
                .filter((category) => category.plannedMinor !== null)
                .map((category) => (
                  <li key={category.categoryId}>
                    <span>{category.categoryName}</span>
                    <strong>
                      {formatMoney(category.plannedMinor!, report.currency)}
                    </strong>
                  </li>
                ))}
            </ul>
            <Link
              className="text-link"
              href={"/budgets?month=" + workspace.targetMonth}
            >
              Inspect budget
            </Link>
          </details>
        </article>
        <article>
          <span>Budget actual</span>
          <strong>{formatMoney(report.budgetActualMinor, report.currency)}</strong>
          <small>Expense postings after refunds</small>
          <details>
            <summary>Trace spending sources</summary>
            <SourceList
              currency={report.currency}
              emptyMessage="No expense postings in this month."
              sources={report.expenseSources}
            />
          </details>
        </article>
        <article>
          <span>Net worth</span>
          <strong>{formatMoney(report.netWorth.netWorthMinor, report.currency)}</strong>
          <small data-positive={changePositive}>
            {changePositive ? (
              <ArrowUpRight aria-hidden="true" size={14} />
            ) : (
              <ArrowDownRight aria-hidden="true" size={14} />
            )}
            {formatMoney(report.netWorth.changeMinor, report.currency)} change
          </small>
          <a className="text-link" href="#net-worth-evidence">
            Trace components
          </a>
        </article>
      </section>

      <section className="monthly-report-grid">
        <article className="report-panel" id="spending-by-category">
          <div className="section-heading">
            <div>
              <p className="card-kicker">Budget report</p>
              <h2>Spending by category</h2>
            </div>
            <Tags aria-hidden="true" size={19} />
          </div>
          <div className="report-category-list">
            {report.expenseCategories.map((category) => (
              <details data-status={category.status} key={category.categoryId}>
                <summary>
                  <div>
                    <strong>{category.categoryName}</strong>
                    <small>
                      {category.plannedMinor === null
                        ? "No budget"
                        : "Planned " +
                          formatMoney(category.plannedMinor, report.currency)}
                    </small>
                  </div>
                  <div>
                    <strong>
                      {formatMoney(category.actualMinor, report.currency)}
                    </strong>
                    <small>
                      {category.remainingMinor === null
                        ? "Unbudgeted"
                        : formatMoney(category.remainingMinor, report.currency) +
                          " remaining"}
                    </small>
                  </div>
                </summary>
                <SourceList
                  currency={report.currency}
                  emptyMessage="No posted spending in this category."
                  sources={category.sources}
                />
              </details>
            ))}
          </div>
        </article>

        <article className="report-panel">
          <div className="section-heading">
            <div>
              <p className="card-kicker">Balance sheet</p>
              <h2>Account balances</h2>
            </div>
            <Landmark aria-hidden="true" size={19} />
          </div>
          <div className="report-account-list">
            {report.accountBalances.map((account) => (
              <details key={account.financialAccountId}>
                <summary>
                  <div>
                    <strong>{account.accountName}</strong>
                    <small>{account.accountType.replaceAll("_", " ")}</small>
                  </div>
                  <strong data-negative={account.balanceMinor < 0}>
                    {formatMoney(account.balanceMinor, report.currency)}
                  </strong>
                </summary>
                <SourceList
                  currency={report.currency}
                  emptyMessage="No posted ledger activity through month-end."
                  sources={account.sources}
                />
              </details>
            ))}
          </div>
        </article>
      </section>

      <section className="report-panel report-net-worth-panel" id="net-worth-evidence">
        <div className="section-heading">
          <div>
            <p className="card-kicker">Assets less liabilities</p>
            <h2>Net worth and debt evidence</h2>
          </div>
          <div className="report-debt-total">
            <span>Total debt</span>
            <strong>{formatMoney(report.netWorth.debtMinor, report.currency)}</strong>
            <small>
              {formatMoney(report.netWorth.debtChangeMinor, report.currency)} change
            </small>
          </div>
        </div>
        <div className="report-net-worth-list">
          {report.netWorth.components.map((component) => {
            const financialAccountId =
              component.source.type === "ledger_account"
                ? component.source.financialAccountId
                : null;
            const account =
              financialAccountId !== null
                ? report.accountBalances.find(
                    (candidate) => candidate.financialAccountId === financialAccountId,
                  )
                : null;
            return (
              <details key={component.key}>
                <summary>
                  <span>
                    {component.kind === "liability" ? (
                      <WalletCards aria-hidden="true" size={16} />
                    ) : (
                      <Scale aria-hidden="true" size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{component.name}</strong>
                    <small>
                      {component.source.type === "manual_valuation"
                        ? "Valuation " +
                          formatCalendarDate(component.source.valuationDate)
                        : component.source.type === "ledger_account"
                          ? "Posted account ledger"
                          : "Transfer explanation ledger"}
                    </small>
                  </div>
                  <strong data-negative={component.amountMinor < 0}>
                    {formatMoney(component.amountMinor, report.currency)}
                  </strong>
                </summary>
                {component.source.type === "manual_valuation" ? (
                  <div className="report-valuation-source">
                    <FileCheck2 aria-hidden="true" size={15} />
                    <span>{component.source.sourceNote}</span>
                    <Link href={"/net-worth?month=" + workspace.targetMonth}>
                      View valuation history
                    </Link>
                  </div>
                ) : account ? (
                  <SourceList
                    currency={report.currency}
                    emptyMessage="No posted ledger activity through month-end."
                    sources={account.sources}
                  />
                ) : (
                  <Link className="text-link" href="/transfers">
                    Inspect transfer explanations
                  </Link>
                )}
              </details>
            );
          })}
        </div>
      </section>

      <section className="monthly-evidence-grid">
        <article className="report-panel">
          <div className="section-heading">
            <div>
              <p className="card-kicker">Statement evidence</p>
              <h2>Included imports</h2>
            </div>
            <span>{readiness.includedStatements.length}</span>
          </div>
          <ul className="included-statement-list">
            {readiness.includedStatements.map((statement) => (
              <li key={statement.importBatchId}>
                <FileCheck2 aria-hidden="true" size={15} />
                <div>
                  <strong>{statement.sourceFilename}</strong>
                  <small>
                    {formatCalendarDate(statement.statementStartDate)} –{" "}
                    {formatCalendarDate(statement.statementEndDate)}
                  </small>
                </div>
                <Link href={"/imports/" + statement.importBatchId + "/review"}>
                  Source
                </Link>
              </li>
            ))}
          </ul>
        </article>
        <article className="report-panel">
          <div className="section-heading">
            <div>
              <p className="card-kicker">Coverage proof</p>
              <h2>Account readiness</h2>
            </div>
            <span>{readiness.coverage.accounts.length}</span>
          </div>
          <ul className="close-coverage-list">
            {readiness.coverage.accounts.map((account) => (
              <li key={account.account.id}>
                <strong>{account.account.name}</strong>
                <span>{account.status.replaceAll("_", " ")}</span>
                <small>
                  {account.requiredWindow
                    ? formatCalendarDate(account.requiredWindow.start) +
                      " – " +
                      formatCalendarDate(account.requiredWindow.end)
                    : "Not applicable"}
                </small>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
