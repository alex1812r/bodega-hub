"use client";

import { Check, X } from "lucide-react";
import type { Ref } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

import type { InvoiceReviewState, InvoiceReviewSummary } from "../reviewModel";
import { formatInvoiceMoney, getDisplayedTotals } from "./invoiceReviewView";

export type InvoiceReviewFooterProps = {
  state: InvoiceReviewState;
  summary: InvoiceReviewSummary;
  footerRef?: Ref<HTMLElement>;
  onLoad: () => void;
  onDiscard: () => void;
};

/**
 * Pie fijo de la revisión: totales leído vs calculado (✓ o diferencia en rojo),
 * pendientes y bloqueos, "Cargar en la compra" (solo con `canLoad`) y "Descartar escaneo".
 */
export function InvoiceReviewFooter({ footerRef, onDiscard, onLoad, state, summary }: InvoiceReviewFooterProps) {
  const totals = getDisplayedTotals(summary.totals);
  const money = (value: number) => formatInvoiceMoney(state, value);

  return (
    <footer
      aria-label="Resumen de la revisión"
      ref={footerRef}
      className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-border bg-surface-container-lowest px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:justify-between dark:border-slate-800"
    >
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="invoice-review-totals">
          <span>
            Total leído <span className="font-medium tabular-nums">{totals.read !== undefined ? money(totals.read) : "—"}</span>
          </span>
          <span aria-hidden>·</span>
          <span>
            Total calculado <span className="font-medium tabular-nums">{money(totals.computed)}</span>
          </span>
          {totals.ok ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <Check aria-hidden className="size-4" />
              <span className="sr-only">Los totales cuadran</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300" data-testid="invoice-review-difference">
              <X aria-hidden className="size-4" />
              {totals.difference !== undefined ? `Diferencia ${money(totals.difference)}` : "Los totales no cuadran"}
            </span>
          )}
        </p>
        <p
          className={cn(
            "text-xs",
            summary.pendingCount > 0 ? "text-amber-700 dark:text-amber-300" : "text-on-surface-variant",
          )}
        >
          {summary.pendingCount === 0
            ? "Sin líneas pendientes"
            : summary.pendingCount === 1
              ? "1 línea pendiente"
              : `${summary.pendingCount} líneas pendientes`}
          {summary.totals.lineMismatches.length > 0
            ? ` · ${summary.totals.lineMismatches.length} con cantidad × costo distinto del total leído`
            : ""}
        </p>
        {summary.blockers.length > 0 ? (
          <ul aria-live="polite" className="text-xs text-on-surface-variant" data-testid="invoice-review-blockers">
            {summary.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
        <Button onClick={onDiscard} variant="ghost">
          Descartar escaneo
        </Button>
        <Button data-load-button disabled={!summary.canLoad} onClick={onLoad}>
          Cargar en la compra
        </Button>
      </div>
    </footer>
  );
}
