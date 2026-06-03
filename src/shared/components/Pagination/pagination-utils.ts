export function getCurrentPage(skip: number, limit: number): number {
  if (limit <= 0) {
    return 1;
  }

  return Math.floor(skip / limit) + 1;
}

export function getTotalPages(total: number, limit: number): number {
  if (limit <= 0 || total <= 0) {
    return 1;
  }

  return Math.ceil(total / limit);
}

export function getSkipForPage(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit);
}

export function getVisiblePageRange(
  currentPage: number,
  totalPages: number,
  siblingCount = 1,
): number[] {
  if (totalPages <= 1) {
    return [1];
  }

  const totalPageNumbers = siblingCount * 2 + 5;

  if (totalPages <= totalPageNumbers) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const leftSibling = Math.max(currentPage - siblingCount, 1);
  const rightSibling = Math.min(currentPage + siblingCount, totalPages);
  const shouldShowLeftEllipsis = leftSibling > 2;
  const shouldShowRightEllipsis = rightSibling < totalPages - 1;

  if (!shouldShowLeftEllipsis && shouldShowRightEllipsis) {
    const leftRange = 3 + siblingCount * 2;
    return [...Array.from({ length: leftRange }, (_, index) => index + 1), -1, totalPages];
  }

  if (shouldShowLeftEllipsis && !shouldShowRightEllipsis) {
    const rightRange = 3 + siblingCount * 2;
    return [
      1,
      -1,
      ...Array.from({ length: rightRange }, (_, index) => totalPages - rightRange + index + 1),
    ];
  }

  if (shouldShowLeftEllipsis && shouldShowRightEllipsis) {
    return [1, -1, ...Array.from({ length: rightSibling - leftSibling + 1 }, (_, index) => leftSibling + index), -1, totalPages];
  }

  return Array.from({ length: totalPages }, (_, index) => index + 1);
}

export function getItemRange(skip: number, limit: number, total: number) {
  if (total <= 0) {
    return { from: 0, to: 0 };
  }

  const from = skip + 1;
  const to = Math.min(skip + limit, total);

  return { from, to };
}
