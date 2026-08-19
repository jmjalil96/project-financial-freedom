import type { Metadata } from "next";

import { inboxFilterSchema } from "@/domain/review";
import { ReviewInbox } from "@/features/reconciliation/review-inbox";
import { listReviewInbox } from "@/features/reconciliation/review-service";

export const metadata: Metadata = {
  title: "Review",
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const query = await searchParams;
  const parsedFilter = inboxFilterSchema.safeParse(query.filter);
  const activeFilter = parsedFilter.success ? parsedFilter.data : undefined;
  const requestedPage = Number(query.page ?? "1");
  const inbox = await listReviewInbox({
    filter: activeFilter,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: 25,
  });

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Source evidence · explicit decisions</p>
          <h1>Review ledger</h1>
          <p>
            Resolve non-finalized import rows across every account. Each decision keeps
            the original statement evidence in view and changes the reconciliation
            equation immediately.
          </p>
        </div>
        <div className="heading-stat">
          <span>{activeFilter ? activeFilter.replaceAll("_", " ") : "Open inbox"}</span>
          <strong>{inbox.totalItems}</strong>
          <small>
            Page {inbox.currentPage} of {inbox.totalPages}
          </small>
        </div>
      </section>

      <ReviewInbox activeFilter={activeFilter} page={inbox} />
    </>
  );
}
