"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

import { usePermission } from "@/shared/auth/usePermission";
import { cn } from "@/shared/utils/cn";

import { usePriceReviewSummary } from "../../hooks/usePriceReview";

export const PRICE_REVIEW_LIST_HREF = "/products?review=1";

/** "3 productos bajaron de ganancia" / "1 producto bajó de ganancia". */
export function describePriceReviewTotal(total: number) {
  return total === 1 ? "1 producto bajó de ganancia" : `${total} productos bajaron de ganancia`;
}

/**
 * Tarjeta del dashboard (PRO-11): cuántos productos están en "Por revisar",
 * con enlace a la lista filtrada. Es un aviso: sin `products.view`, cargando,
 * con error (403 incluido) o con 0 productos no pinta nada, así nunca rompe ni
 * ocupa el dashboard.
 */
export function PriceReviewDashboardCard({ className }: { className?: string }) {
  const { can, isLoading } = usePermission();
  const canView = !isLoading && can("products.view");
  const summary = usePriceReviewSummary({ enabled: canView });
  const total = summary.data?.total ?? 0;

  if (!canView || summary.error || total <= 0) {
    return null;
  }

  return (
    <Link
      className={cn(
        "flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-amber-900 dark:bg-amber-950 dark:hover:bg-amber-900",
        className,
      )}
      href={PRICE_REVIEW_LIST_HREF}
    >
      <AlertTriangle aria-hidden className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {describePriceReviewTotal(total)}
        </span>
        <span className="block text-xs text-on-surface-variant">
          Su costo subió y el precio sigue igual.
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-300">
        Revisar
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </Link>
  );
}
