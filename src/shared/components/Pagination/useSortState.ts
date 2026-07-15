"use client";

import { useCallback, useState } from "react";

import { toggleSort, type SortOrder } from "@/lib/api/sorting";

export type SortStateConfig = {
  defaultSortBy?: string;
  defaultSortOrder?: SortOrder;
};

export function useSortState(config: SortStateConfig = {}) {
  const [sortBy, setSortBy] = useState(config.defaultSortBy ?? "name");
  const [sortOrder, setSortOrder] = useState<SortOrder>(config.defaultSortOrder ?? "asc");

  const handleSort = useCallback((column: string) => {
    const next = toggleSort({ sortBy, sortOrder }, column);
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
  }, [sortBy, sortOrder]);

  return {
    handleSort,
    setSortBy,
    setSortOrder,
    sortBy,
    sortOrder,
  };
}
