"use client";

import { useMediaQuery } from "@/shared/hooks/useMediaQuery";

import { Pagination, type PaginationProps } from "./Pagination";

/**
 * Uses compact pagination below Tailwind `lg` (1024px). Antes de que el media
 * query resuelva (SSR / primer render) pinta la variante por defecto, que ya se
 * compacta sola por CSS por debajo de `sm`: tampoco desborda a 390 px.
 */
export function ResponsivePagination(props: PaginationProps) {
  const isBelowLg = useMediaQuery("(max-width: 1023px)");
  const variant = props.variant ?? (isBelowLg ? "compact" : "default");

  return <Pagination {...props} variant={variant} />;
}
