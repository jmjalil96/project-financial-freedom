import Link from "next/link";

import { inboxFilters, type InboxFilter } from "@/domain/review";

const filterLabels: Record<InboxFilter, string> = {
  needs_category: "Needs category",
  unknown_type: "Unknown type",
  suspected_duplicate: "Suspected duplicate",
  possible_transfer: "Possible transfer",
  date_uncertainty: "Date uncertainty",
  reconciliation_blocker: "Reconciliation blocker",
  ready_to_finalize: "Ready to finalize",
};

export function ReviewFilterBar({ activeFilter }: { activeFilter?: InboxFilter }) {
  return (
    <nav aria-label="Filter review rows" className="review-filter-bar">
      <Link
        aria-current={activeFilter === undefined ? "page" : undefined}
        data-active={activeFilter === undefined}
        href="/review"
      >
        All open rows
      </Link>
      {inboxFilters.map((filter) => (
        <Link
          aria-current={activeFilter === filter ? "page" : undefined}
          data-active={activeFilter === filter}
          href={`/review?filter=${filter}`}
          key={filter}
        >
          {filterLabels[filter]}
        </Link>
      ))}
    </nav>
  );
}
