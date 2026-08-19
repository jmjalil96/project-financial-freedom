import { CalendarRange, CheckCircle2, CircleAlert, FileClock } from "lucide-react";
import Link from "next/link";

import { formatCalendarDate } from "@/domain/calendar-date";
import type {
  AccountCoverageResult,
  CalendarInterval,
} from "@/domain/coverage";
import type { MonthCoverageSummary } from "@/features/coverage/coverage-service";

const statusCopy = {
  complete: "Complete",
  gap: "Coverage gap",
  pending_finalization: "Awaiting finalization",
  no_evidence: "No statement evidence",
  not_required: "Optional account",
  not_applicable: "Not active in this period",
} as const;

function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
}

function intervalStyle(
  interval: CalendarInterval,
  window: CalendarInterval,
): { left: string; width: string } {
  const start = Math.max(dayNumber(interval.start), dayNumber(window.start));
  const end = Math.min(dayNumber(interval.end), dayNumber(window.end));
  const windowStart = dayNumber(window.start);
  const windowDays = dayNumber(window.end) - windowStart + 1;
  return {
    left: `${((start - windowStart) / windowDays) * 100}%`,
    width: `${Math.max(((end - start + 1) / windowDays) * 100, 0.5)}%`,
  };
}

function CoverageTimeline({ result }: { result: AccountCoverageResult }) {
  const window = result.requiredWindow;
  if (!window) {
    return <p className="coverage-timeline__na">No coverage is required in this month.</p>;
  }
  return (
    <div className="coverage-timeline">
      <div className="coverage-timeline__dates">
        <span>{formatCalendarDate(window.start)}</span>
        <span>{formatCalendarDate(window.end)}</span>
      </div>
      <div
        aria-label={`Required coverage from ${window.start} through ${window.end}`}
        className="coverage-timeline__track"
      >
        {result.finalizedCoverage.map((interval) => (
          <span
            className="coverage-timeline__segment coverage-timeline__segment--final"
            key={`final-${interval.start}-${interval.end}`}
            style={intervalStyle(interval, window)}
            title={`Finalized: ${interval.start} through ${interval.end}`}
          />
        ))}
        {result.pendingCoverage.map((interval) => (
          <span
            className="coverage-timeline__segment coverage-timeline__segment--pending"
            key={`pending-${interval.start}-${interval.end}`}
            style={intervalStyle(interval, window)}
            title={`Not finalized: ${interval.start} through ${interval.end}`}
          />
        ))}
        {result.gaps.map((interval) => (
          <span
            className="coverage-timeline__segment coverage-timeline__segment--gap"
            key={`gap-${interval.start}-${interval.end}`}
            style={intervalStyle(interval, window)}
            title={`Gap: ${interval.start} through ${interval.end}`}
          />
        ))}
      </div>
      <div className="coverage-timeline__legend">
        <span data-kind="final">Finalized</span>
        <span data-kind="pending">Pending</span>
        <span data-kind="gap">Gap</span>
      </div>
    </div>
  );
}

function AccountCoverageCard({ result }: { result: AccountCoverageResult }) {
  const complete = result.status === "complete";
  return (
    <article className="coverage-account" data-status={result.status}>
      <header>
        <div>
          <p>{result.account.requiredForClose ? "Required account" : "Optional account"}</p>
          <h2>{result.account.name}</h2>
        </div>
        <span className="coverage-account__status">
          {complete ? (
            <CheckCircle2 aria-hidden="true" size={16} />
          ) : (
            <CircleAlert aria-hidden="true" size={16} />
          )}
          {statusCopy[result.status]}
        </span>
      </header>
      <CoverageTimeline result={result} />

      {result.gaps.length > 0 && result.account.requiredForClose ? (
        <div className="coverage-account__gaps">
          <strong>Missing finalized evidence</strong>
          <ul>
            {result.gaps.map((gap) => (
              <li key={`${gap.start}-${gap.end}`}>
                {formatCalendarDate(gap.start)} – {formatCalendarDate(gap.end)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="coverage-account__statements">
        <h3>Statement intervals</h3>
        {result.statements.length > 0 ? (
          <ul>
            {result.statements.map((statement) => (
              <li key={statement.batchId}>
                <div>
                  <strong>
                    {formatCalendarDate(statement.start)} –{" "}
                    {formatCalendarDate(statement.end)}
                  </strong>
                  <span>
                    {statement.sourceFilename} · {statement.reviewStatus.replace("_", " ")}
                  </span>
                </div>
                <Link href={`/imports/${statement.batchId}/review`}>Open</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No imported statement reaches this target month.</p>
        )}
      </div>
    </article>
  );
}

export function CoverageWorkspace({ summary }: { summary: MonthCoverageSummary }) {
  return (
    <main className="coverage-workspace">
      <header className="coverage-workspace__hero">
        <div>
          <p className="eyebrow">Statement evidence map</p>
          <h1>Coverage through {formatCalendarDate(summary.monthEnd)}</h1>
          <p>
            Finalized statement intervals—not transaction dates—prove whether each
            required account is complete. Cross-month cycles count exactly where they
            overlap.
          </p>
        </div>
        <form className="coverage-month-form">
          <label htmlFor="coverage-month">Target month</label>
          <input
            defaultValue={summary.targetMonth}
            id="coverage-month"
            name="month"
            type="month"
          />
          <button className="primary-button" type="submit">
            View coverage
          </button>
        </form>
      </header>

      <section className="coverage-summary" data-complete={summary.isCoverageComplete}>
        <span className="coverage-summary__icon">
          {summary.isCoverageComplete ? (
            <CheckCircle2 aria-hidden="true" size={22} />
          ) : (
            <FileClock aria-hidden="true" size={22} />
          )}
        </span>
        <div>
          <p className="card-kicker">Coverage gate</p>
          <h2>
            {summary.completeAccountCount} of {summary.requiredAccountCount} required
            accounts complete
          </h2>
          <p>
            {summary.isCoverageComplete
              ? "Required statement evidence reaches the target month-end."
              : `${summary.blockedAccountCount} required ${
                  summary.blockedAccountCount === 1 ? "account needs" : "accounts need"
                } more finalized coverage before month close.`}
          </p>
        </div>
        <CalendarRange aria-hidden="true" className="coverage-summary__watermark" />
      </section>

      <section aria-label="Coverage by account" className="coverage-account-list">
        {summary.accounts.length > 0 ? (
          summary.accounts.map((result) => (
            <AccountCoverageCard key={result.account.id} result={result} />
          ))
        ) : (
          <div className="coverage-workspace__empty">
            <h2>No accounts to evaluate</h2>
            <p>Create a financial account before reviewing statement coverage.</p>
          </div>
        )}
      </section>
    </main>
  );
}
