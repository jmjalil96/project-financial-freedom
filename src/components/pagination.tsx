import Link from "next/link";

export function Pagination({
  currentPage,
  totalPages,
  pathname,
  newerLabel,
  olderLabel,
}: {
  currentPage: number;
  totalPages: number;
  pathname: string;
  newerLabel: string;
  olderLabel: string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav aria-label={`${pathname.slice(1)} pages`} className="pagination">
      {currentPage > 1 ? (
        <Link href={`${pathname}?page=${currentPage - 1}`}>{newerLabel}</Link>
      ) : (
        <span />
      )}
      <span>
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link href={`${pathname}?page=${currentPage + 1}`}>{olderLabel}</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
