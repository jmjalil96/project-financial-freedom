import { Inbox, Rows3 } from "lucide-react";
import Link from "next/link";

import { Pagination } from "@/components/pagination";
import { formatCalendarDate } from "@/domain/calendar-date";
import type { InboxFilter } from "@/domain/review";
import { ReviewFilterBar } from "@/features/reconciliation/review-filter-bar";
import { ReviewRowCard } from "@/features/reconciliation/review-row-card";
import type { ReviewInboxPage } from "@/features/reconciliation/review-service";

export function ReviewInbox({
  activeFilter,
  page,
}: {
  activeFilter?: InboxFilter;
  page: ReviewInboxPage;
}) {
  const groups = new Map<number, ReviewInboxPage["items"]>();
  for (const row of page.items) {
    const rows = groups.get(row.batch.id);
    if (rows) {
      rows.push(row);
    } else {
      groups.set(row.batch.id, [row]);
    }
  }

  return (
    <section aria-labelledby="review-inbox-title" className="review-inbox">
      <div className="review-inbox__heading">
        <div>
          <p className="card-kicker">Non-finalized source rows</p>
          <h2 id="review-inbox-title">Review inbox</h2>
          <p>
            Filter by unresolved evidence, then save an explicit decision against the
            original source row.
          </p>
        </div>
        <span>
          <Inbox aria-hidden="true" size={18} />
          {page.totalItems} {page.totalItems === 1 ? "row" : "rows"}
        </span>
      </div>

      <ReviewFilterBar activeFilter={activeFilter} />

      {page.items.length > 0 ? (
        <div className="review-statement-groups">
          {[...groups.entries()].map(([batchId, rows]) => {
            const first = rows[0]!;
            return (
              <section
                aria-labelledby={`review-statement-${batchId}`}
                className="review-statement-group"
                key={batchId}
              >
                <header className="review-statement-group__header">
                  <div>
                    <span className="review-statement-group__index">
                      <Rows3 aria-hidden="true" size={14} />
                      Import #{batchId}
                    </span>
                    <h3 id={`review-statement-${batchId}`}>
                      {first.account.name} · {first.batch.sourceFilename}
                    </h3>
                    <p>
                      {formatCalendarDate(first.batch.statementStartDate)} to{" "}
                      {formatCalendarDate(first.batch.statementEndDate)} · {rows.length}{" "}
                      shown on this page
                    </p>
                  </div>
                  <Link className="quiet-button" href={`/imports/${batchId}/review`}>
                    Open statement workspace
                  </Link>
                </header>
                <div className="review-statement-group__rows">
                  {rows.map((row) => (
                    <ReviewRowCard
                      categories={page.availableCategories}
                      key={row.id}
                      row={row}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <Pagination
            currentPage={page.currentPage}
            newerLabel="Previous review rows"
            olderLabel="Next review rows"
            pathname="/review"
            searchParams={activeFilter ? { filter: activeFilter } : undefined}
            totalPages={page.totalPages}
          />
        </div>
      ) : (
        <div className="compact-empty review-inbox__empty">
          <Inbox aria-hidden="true" size={25} />
          <h2>No rows match this review filter</h2>
          <p>
            Choose another evidence filter, or import a statement to create review work.
          </p>
          {activeFilter ? (
            <Link className="quiet-button" href="/review">
              Show all open rows
            </Link>
          ) : (
            <Link className="quiet-button" href="/imports">
              Open imports
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
