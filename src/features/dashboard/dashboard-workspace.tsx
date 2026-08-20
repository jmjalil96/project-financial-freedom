import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CircleAlert,
  CircleDashed,
  FileSearch,
  Landmark,
  ListChecks,
  Minus,
  PiggyBank,
  ReceiptText,
  Repeat2,
  Scale,
  Store,
  Tags,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { formatCalendarDate, formatCalendarMonth } from "@/domain/calendar-date";
import { formatMoney } from "@/domain/money";
import { formatSavingsRate } from "@/domain/monthly-report";
import type {
  DashboardTask,
  DashboardWorkspace as DashboardWorkspaceView,
} from "@/features/dashboard/dashboard-service";

function TraceLink({
  href,
  label = "Trace sources",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link className="dashboard-trace-link" href={href}>
      {label}
      <ArrowRight aria-hidden="true" size={13} />
    </Link>
  );
}

function ChangeValue({
  amountMinor,
  currency,
  suffix = "from prior month",
}: {
  amountMinor: number;
  currency: DashboardWorkspaceView["focusReport"]["currency"];
  suffix?: string;
}) {
  const positive = amountMinor > 0;
  const negative = amountMinor < 0;
  return (
    <small data-positive={positive}>
      {positive ? (
        <ArrowUpRight aria-hidden="true" size={13} />
      ) : negative ? (
        <ArrowDownRight aria-hidden="true" size={13} />
      ) : (
        <Minus aria-hidden="true" size={13} />
      )}
      {formatMoney(amountMinor, currency)} {suffix}
    </small>
  );
}

function TaskState({ task }: { task: DashboardTask }) {
  return (
    <span className="dashboard-task__state" data-status={task.status}>
      {task.status === "complete" ? (
        <Check aria-hidden="true" size={13} />
      ) : task.status === "attention" ? (
        <CircleAlert aria-hidden="true" size={13} />
      ) : (
        <CircleDashed aria-hidden="true" size={13} />
      )}
      {task.status === "complete"
        ? "Clear"
        : task.status === "attention"
          ? "Attention"
          : "Waiting"}
    </span>
  );
}

function formatClosedAt(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function EmptyDashboard({ workspace }: { workspace: DashboardWorkspaceView }) {
  return (
    <main className="decision-dashboard">
      <section className="dashboard-empty">
        <span>
          <Landmark aria-hidden="true" size={26} />
        </span>
        <p className="eyebrow">Your monthly record starts here</p>
        <h1>Establish an opening position.</h1>
        <p>
          Add the accounts you own or owe. Their balanced opening positions become the
          first traceable evidence for net worth and monthly review.
        </p>
        <Link className="primary-button" href="/accounts">
          Add the first account
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
        <small>
          {formatCalendarMonth(workspace.currentMonth)} remains provisional until the
          workflow has evidence to review.
        </small>
      </section>
    </main>
  );
}

export function DashboardWorkspace({
  workspace,
}: {
  workspace: DashboardWorkspaceView;
}) {
  if (workspace.activeAccountCount === 0) {
    return <EmptyDashboard workspace={workspace} />;
  }
  const { focusReport, comparison, currentReport } = workspace;
  const reportHref = `/month-close?month=${workspace.focusMonth}`;
  const currentHref = `/month-close?month=${workspace.currentMonth}`;
  const currentBudgetAttention = currentReport.expenseCategories
    .filter(
      (category) => category.remainingMinor !== null && category.remainingMinor < 0,
    )
    .sort(
      (left, right) =>
        left.remainingMinor! - right.remainingMinor! ||
        left.categoryName.localeCompare(right.categoryName),
    );
  const largestAmount = comparison.largestSpending[0]?.actualMinor ?? 0;
  const hasChangeFacts =
    workspace.comparisonHasEvidence ||
    comparison.incomeChangeMinor !== 0 ||
    comparison.debtChangeMinor !== 0 ||
    comparison.netWorthChangeMinor !== 0;

  return (
    <main className="decision-dashboard">
      <header className="dashboard-hero" data-state={workspace.focusState}>
        <div>
          <p className="eyebrow">Monthly decision brief</p>
          <h1>
            {workspace.lastClosed
              ? `${formatCalendarMonth(workspace.focusMonth)} is closed and explainable.`
              : `${formatCalendarMonth(workspace.currentMonth)} remains provisional.`}
          </h1>
          <p>
            {workspace.lastClosed
              ? `Revision ${workspace.lastClosed.revisionNumber} is the latest trusted result. Current-month activity stays separate until its evidence is complete.`
              : "The figures below update from posted evidence, but they are not final until the month passes every closing gate."}
          </p>
          <div className="dashboard-hero__meta">
            {workspace.lastClosed ? (
              <span>
                <BadgeCheck aria-hidden="true" size={14} />
                Closed {formatClosedAt(workspace.lastClosed.closedAt)}
              </span>
            ) : (
              <span>
                <CalendarClock aria-hidden="true" size={14} />
                No closed month yet
              </span>
            )}
            <TraceLink
              href={reportHref}
              label={
                workspace.lastClosed ? "Open preserved report" : "Inspect live report"
              }
            />
          </div>
        </div>
        <aside className="dashboard-current-card">
          <span>Current provisional month</span>
          <strong>{formatCalendarMonth(workspace.currentMonth)}</strong>
          <p>
            {workspace.attentionCount > 0
              ? `${workspace.attentionCount} workflow ${workspace.attentionCount === 1 ? "area needs" : "areas need"} attention.`
              : "No actionable evidence gap is known right now."}
          </p>
          <Link href={currentHref}>
            Review close readiness
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </aside>
      </header>

      <section className="dashboard-kpis" aria-label="Financial summary">
        <article>
          <span>
            <Scale aria-hidden="true" size={16} /> Net worth
          </span>
          <strong>
            {formatMoney(focusReport.netWorth.netWorthMinor, focusReport.currency)}
          </strong>
          <ChangeValue
            amountMinor={comparison.netWorthChangeMinor}
            currency={focusReport.currency}
          />
          <TraceLink href={`${reportHref}#net-worth-evidence`} />
        </article>
        <article>
          <span>
            <PiggyBank aria-hidden="true" size={16} /> Income
          </span>
          <strong>{formatMoney(focusReport.incomeMinor, focusReport.currency)}</strong>
          <ChangeValue
            amountMinor={comparison.incomeChangeMinor}
            currency={focusReport.currency}
          />
          <TraceLink href={reportHref} />
        </article>
        <article>
          <span>
            <ReceiptText aria-hidden="true" size={16} /> Expenses
          </span>
          <strong>
            {formatMoney(focusReport.expensesMinor, focusReport.currency)}
          </strong>
          <small>
            {focusReport.expenseSources.length} source posting
            {focusReport.expenseSources.length === 1 ? " entry" : " entries"}
          </small>
          <TraceLink href={`${reportHref}#spending-by-category`} />
        </article>
        <article>
          <span>
            <WalletCards aria-hidden="true" size={16} /> Savings
          </span>
          <strong>{formatMoney(focusReport.savingsMinor, focusReport.currency)}</strong>
          <small>
            {formatSavingsRate(focusReport.savingsRateBasisPoints)} savings rate
          </small>
          <TraceLink href={reportHref} label="Trace calculation" />
        </article>
      </section>

      <section className="dashboard-primary-grid">
        <article className="dashboard-panel dashboard-spending-panel">
          <div className="dashboard-panel__heading">
            <div>
              <p className="card-kicker">Where money went</p>
              <h2>Largest spending categories</h2>
            </div>
            <Tags aria-hidden="true" size={19} />
          </div>
          {comparison.largestSpending.length > 0 ? (
            <ol className="dashboard-spending-list">
              {comparison.largestSpending.map((category) => (
                <li key={category.categoryId}>
                  <div>
                    <strong>{category.categoryName}</strong>
                    <span>
                      {category.sourceCount} source
                      {category.sourceCount === 1 ? " entry" : " entries"}
                    </span>
                  </div>
                  <strong>
                    {formatMoney(category.actualMinor, focusReport.currency)}
                  </strong>
                  <span className="dashboard-spending-list__track">
                    <span
                      style={{
                        width: `${largestAmount > 0 ? (category.actualMinor / largestAmount) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="dashboard-panel-empty">
              No posted expense category appears in this report.
            </div>
          )}
          <TraceLink
            href={`${reportHref}#spending-by-category`}
            label="Inspect category sources"
          />
        </article>

        <article className="dashboard-panel dashboard-budget-panel">
          <div className="dashboard-panel__heading">
            <div>
              <p className="card-kicker">Current month</p>
              <h2>Budget attention</h2>
            </div>
            <span className="dashboard-panel__count">
              {currentBudgetAttention.length}
            </span>
          </div>
          {currentBudgetAttention.length > 0 ? (
            <ul className="dashboard-budget-list">
              {currentBudgetAttention.slice(0, 4).map((category) => (
                <li key={category.categoryId}>
                  <div>
                    <strong>{category.categoryName}</strong>
                    <small>
                      {formatMoney(category.actualMinor, currentReport.currency)} actual
                    </small>
                  </div>
                  <span>
                    {formatMoney(
                      Math.abs(category.remainingMinor!),
                      currentReport.currency,
                    )}
                    over
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-panel-empty dashboard-panel-empty--success">
              <Check aria-hidden="true" size={17} />
              No category is over a set target. {currentReport.missingBudgetCount}{" "}
              active
              {currentReport.missingBudgetCount === 1
                ? " category has"
                : " categories have"}{" "}
              no optional target.
            </div>
          )}
          <TraceLink
            href={`/budgets?month=${workspace.currentMonth}`}
            label="Open current budget"
          />
        </article>
      </section>

      <section className="dashboard-workflow-panel">
        <div className="dashboard-panel__heading">
          <div>
            <p className="card-kicker">What requires attention</p>
            <h2>Current monthly review</h2>
          </div>
          <ListChecks aria-hidden="true" size={20} />
        </div>
        <ol className="dashboard-task-list">
          {workspace.tasks.map((task) => (
            <li data-status={task.status} key={task.id}>
              <TaskState task={task} />
              <div>
                <strong>{task.label}</strong>
                <p>{task.detail}</p>
              </div>
              <Link aria-label={`Open ${task.label}`} href={task.href}>
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="dashboard-insight-grid">
        <article className="dashboard-panel dashboard-change-panel">
          <div className="dashboard-panel__heading">
            <div>
              <p className="card-kicker">What changed</p>
              <h2>Month-over-month facts</h2>
            </div>
            <span>{formatCalendarMonth(workspace.comparisonMonth)}</span>
          </div>
          {hasChangeFacts ? (
            <ul className="dashboard-fact-list">
              <li>
                <span>Income</span>
                <strong>
                  {comparison.incomeChangeMinor === 0
                    ? "Unchanged"
                    : `${formatMoney(Math.abs(comparison.incomeChangeMinor), focusReport.currency)} ${comparison.incomeChangeMinor > 0 ? "higher" : "lower"}`}
                </strong>
              </li>
              <li>
                <span>Debt</span>
                <strong>
                  {comparison.debtChangeMinor === 0
                    ? "Unchanged"
                    : `${formatMoney(Math.abs(comparison.debtChangeMinor), focusReport.currency)} ${comparison.debtChangeMinor > 0 ? "higher" : "lower"}`}
                </strong>
              </li>
              {comparison.categoryIncreases.slice(0, 3).map((category) => (
                <li key={category.categoryId}>
                  <span>{category.categoryName}</span>
                  <strong>
                    {formatMoney(category.changeMinor, focusReport.currency)} more
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-panel-empty">
              Close another month to establish a month-over-month comparison.
            </div>
          )}
          <TraceLink
            href={`/month-close?month=${workspace.comparisonMonth}`}
            label="Open prior report"
          />
        </article>

        <article className="dashboard-panel dashboard-bridge-panel">
          <div className="dashboard-panel__heading">
            <div>
              <p className="card-kicker">Net-worth bridge</p>
              <h2>Why the position changed</h2>
            </div>
            <Scale aria-hidden="true" size={19} />
          </div>
          <dl className="dashboard-bridge-list">
            <div>
              <dt>Income less expenses</dt>
              <dd>
                {formatMoney(
                  comparison.cashFlowContributionMinor,
                  focusReport.currency,
                )}
              </dd>
            </div>
            <div>
              <dt>Manual-value movement</dt>
              <dd>
                {formatMoney(
                  comparison.manualValueContributionMinor,
                  focusReport.currency,
                )}
              </dd>
            </div>
            <div>
              <dt>Other balance-sheet movement</dt>
              <dd>
                {formatMoney(
                  comparison.otherPositionContributionMinor,
                  focusReport.currency,
                )}
              </dd>
            </div>
            <div className="dashboard-bridge-list__total">
              <dt>Net-worth change</dt>
              <dd>
                {formatMoney(comparison.netWorthChangeMinor, focusReport.currency)}
              </dd>
            </div>
          </dl>
          <p>
            “Other” keeps opening positions, documented adjustments, and remaining
            balance-sheet movements visible instead of attributing them to spending.
          </p>
          <TraceLink
            href={`${reportHref}#net-worth-evidence`}
            label="Trace the bridge"
          />
        </article>
      </section>

      <section className="dashboard-signal-grid">
        <article className="dashboard-panel">
          <div className="dashboard-panel__heading">
            <div>
              <p className="card-kicker">Source descriptions</p>
              <h2>Repeated activity</h2>
            </div>
            <Repeat2 aria-hidden="true" size={19} />
          </div>
          {workspace.repeatedDescriptions.length > 0 ? (
            <ul className="dashboard-signal-list">
              {workspace.repeatedDescriptions.map((fact) => (
                <li key={fact.description}>
                  <Repeat2 aria-hidden="true" size={15} />
                  <div>
                    <strong>{fact.description}</strong>
                    <span>
                      {fact.occurrenceCount} occurrences across {fact.monthCount} months
                    </span>
                  </div>
                  <strong>
                    {formatMoney(fact.currentAmountMinor, focusReport.currency)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-panel-empty">
              No description repeats across multiple recent months.
            </div>
          )}
          <TraceLink href={`${reportHref}#spending-by-category`} />
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel__heading">
            <div>
              <p className="card-kicker">Imported evidence</p>
              <h2>First-seen merchants</h2>
            </div>
            <Store aria-hidden="true" size={19} />
          </div>
          {workspace.newMerchants.length > 0 ? (
            <ul className="dashboard-signal-list">
              {workspace.newMerchants.map((merchant) => (
                <li key={merchant.name}>
                  <Store aria-hidden="true" size={15} />
                  <div>
                    <strong>{merchant.name}</strong>
                    <span>
                      First seen in {formatCalendarMonth(workspace.focusMonth)} ·{" "}
                      {merchant.transactionCount}{" "}
                      {merchant.transactionCount === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <strong>
                    {formatMoney(merchant.amountMinor, focusReport.currency)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-panel-empty">
              No first-seen imported merchant appears in this report.
            </div>
          )}
          <TraceLink href={reportHref} />
        </article>
      </section>

      <section className="dashboard-evidence-watch">
        <div>
          <FileSearch aria-hidden="true" size={20} />
          <div>
            <p className="card-kicker">Evidence watch</p>
            <h2>Missing and stale information</h2>
          </div>
        </div>
        {workspace.staleValuations.length > 0 ? (
          <ul>
            {workspace.staleValuations.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong>
                <span>
                  {item.valuationDate
                    ? `Latest evidence: ${formatCalendarDate(item.valuationDate)}`
                    : "No applicable valuation"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No applicable manual value is missing or stale for the current month.</p>
        )}
        <TraceLink
          href={`/net-worth?month=${workspace.currentMonth}`}
          label="Inspect valuation evidence"
        />
      </section>
    </main>
  );
}
