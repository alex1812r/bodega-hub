"use client";

import { useMediaQuery } from "@/shared/hooks/useMediaQuery";

import { Pagination, type PaginationProps } from "./Pagination";

/** Uses compact pagination below Tailwind `lg` (1024px). */
export function ResponsivePagination(props: PaginationProps) {
  const isBelowLg = useMediaQuery("(max-width: 1023px)");
  const variant = props.variant ?? (isBelowLg ? "compact" : "default");

  return <Pagination {...props} variant={variant} />;
}
