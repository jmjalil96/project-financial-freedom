import Link from "next/link";

export function Pagination({
  currentPage,
  totalPages,
  pathname,
  newerLabel,
  olderLabel,
  searchParams,
}: {
  currentPage: number;
  totalPages: number;
  pathname: string;
  newerLabel: string;
  olderLabel: string;
  searchParams?: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value !== undefined) {
        query.set(key, value);
      }
    }
    query.set("page", String(page));
    return `${pathname}?${query.toString()}`;
  };

  return (
    <nav aria-label={`${pathname.slice(1)} pages`} className="pagination">
      {currentPage > 1 ? (
        <Link href={pageHref(currentPage - 1)}>{newerLabel}</Link>
      ) : (
        <span />
      )}
      <span>
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link href={pageHref(currentPage + 1)}>{olderLabel}</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
