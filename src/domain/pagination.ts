export type PaginationState = {
  currentPage: number;
  totalPages: number;
  offset: number;
};

export function getPaginationState(
  rawPage: string | undefined,
  totalItems: number,
  pageSize: number,
): PaginationState {
  const requestedPage = Number(rawPage ?? "1");
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, totalPages)
      : 1;

  return {
    currentPage,
    totalPages,
    offset: (currentPage - 1) * pageSize,
  };
}
