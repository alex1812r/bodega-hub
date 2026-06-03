"use client";

import { useState } from "react";

import { DEFAULT_PAGE_LIMIT } from "@/lib/api/pagination";

function getResetKey(resetDeps: readonly unknown[]) {
  return JSON.stringify(resetDeps);
}

/**
 * Local skip/limit state for list pages. Pass filter fields in `resetDeps` so skip
 * returns to 0 when filters change (reference: products-list/page.tsx).
 */
export function usePaginationState(
  resetDeps: readonly unknown[] = [],
  initialLimit = DEFAULT_PAGE_LIMIT,
) {
  const resetKey = getResetKey(resetDeps);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(initialLimit);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setSkip(0);
  }

  return { limit, setLimit, setSkip, skip };
}
