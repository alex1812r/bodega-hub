"use client";

import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { type CSSProperties, type Ref, useId, useState } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

import {
  getTaxInclusion,
  type InvoiceReviewAction,
  type InvoiceReviewState,
  type InvoiceReviewSummary,
  type InvoiceReviewTotals,
} from "../reviewModel";
import { formatInvoiceMoney, getDisplayedTotals } from "./invoiceReviewView";

export type InvoiceReviewFooterProps = {
  state: InvoiceReviewState;
  summary: InvoiceReviewSummary;
  footerRef?: Ref<HTMLElement>;
  onAction: (action: InvoiceReviewAction) => void;
  onLoad: () => void;
  onDiscard: () => void;
  /** D46-a: alto mínimo del detalle (pendientes y bloqueos) con el layout pendiente. */
  detailStyle?: CSSProperties;
  /** REP12-01 (D52): aviso de factura duplicada sin reconocer; Cargar lo exige. */
  duplicateUnacknowledged?: boolean;
};

/**
 * Pie fijo de la revisión. Arriba, en una línea: el total que se va a registrar (base +
 * IVA de las alícuotas elegidas, SCN-UI-Q1) con ✓ o la diferencia frente al leído, y
 * "Cargar en la compra". En móvil el detalle (leído, pendientes, bloqueos y "Descartar
 * escaneo") se despliega con la flecha (B-6: el pie ocupaba ~27 % de una pantalla de
 * 390); desde `sm` se ve siempre. D25-a: con diferencia frente al leído, Cargar exige
 * marcar la confirmación de esa diferencia (siempre visible mientras la haya). D29: la
 * referencia es el total leído; sin él, subtotal + IVA leídos; sin IVA, el subtotal
 * (frente a la base a registrar); sin subtotal, el IVA (frente al IVA a registrar). Sin
 * ninguna cifra leída no hay casilla y se informa que no hay con qué comparar.
 */
const READ_LABELS: Record<NonNullable<InvoiceReviewTotals["readSource"]>, { label: string; against: string }> = {
  total: { label: "Leído", against: "total leído" },
  subtotalPlusTax: { label: "Subtotal + IVA leídos", against: "subtotal + IVA leídos" },
  subtotal: { label: "Subtotal leído", against: "subtotal leído (base sin IVA)" },
  tax: { label: "IVA leído", against: "IVA leído" },
};

export function InvoiceReviewFooter({
  detailStyle,
  duplicateUnacknowledged = false,
  footerRef,
  onAction,
  onDiscard,
  onLoad,
  state,
  summary,
}: InvoiceReviewFooterProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = useId();
  const totals = getDisplayedTotals(summary.totals);
  const pricesIncludeTax = getTaxInclusion(state).included;
  const money = (value: number) => formatInvoiceMoney(state, value);
  const readText = totals.read !== undefined ? money(totals.read) : "—";
  const { readSource } = summary.totals;
  const sourceCopy = READ_LABELS[readSource ?? "total"];
  let readLabel = sourceCopy.label;
  if (readSource === "subtotal") {
    readLabel = `Base a registrar ${money(summary.totals.base)} · ${sourceCopy.label}`;
  } else if (readSource === "tax") {
    readLabel = `IVA a registrar ${money(summary.totals.tax)} · ${sourceCopy.label}`;
  }
  const collapsible = detailOpen ? null : "hidden sm:flex";

  return (
    <footer
      aria-label="Resumen de la revisión"
      ref={footerRef}
      className="sticky bottom-0 z-10 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 border-t border-border bg-surface-container-lowest px-4 py-2 text-sm shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-x-3 sm:py-3 dark:border-slate-800"
      // D36: contenedor neutro que recibe el foco al no quedar pendientes (Tab sigue a Cargar);
      // Espacio sobre él no desplaza la página (como en las filas, B6-1).
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === " ") {
          event.preventDefault();
        }
      }}
      tabIndex={-1}
    >
      <p
        className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
        data-testid="invoice-review-totals"
      >
        <span>
          Total a registrar <span className="font-medium tabular-nums">{money(totals.registered)}</span>
        </span>
        <span aria-hidden className="hidden sm:inline">
          ·
        </span>
        <span className="hidden sm:inline">
          {readLabel} <span className="font-medium tabular-nums">{readText}</span>
        </span>
        {totals.read === undefined ? (
          <span className="text-xs text-on-surface-variant" data-testid="invoice-review-no-reference">
            Sin total, subtotal ni IVA leídos para comparar: revisa los importes con la factura
          </span>
        ) : totals.ok ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <Check aria-hidden className="size-4" />
            <span className="sr-only">{`Cuadra con el ${sourceCopy.against}`}</span>
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300"
            data-testid="invoice-review-difference"
          >
            <X aria-hidden className="size-4" />
            {totals.difference !== undefined ? `Diferencia ${money(totals.difference)}` : "Los totales no cuadran"}
          </span>
        )}
      </p>

      <Button
        aria-label="Cargar en la compra"
        className="col-start-2 row-start-1 sm:col-start-3 sm:row-span-2"
        data-load-button
        disabled={!summary.canLoad || duplicateUnacknowledged}
        onClick={onLoad}
      >
        <span className="sm:hidden">Cargar</span>
        <span className="hidden sm:inline">Cargar en la compra</span>
      </Button>

      <button
        aria-controls={detailId}
        aria-expanded={detailOpen}
        aria-label={detailOpen ? "Ocultar detalle del total" : "Ver detalle del total"}
        data-guarded-activation
        className="col-start-3 row-start-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        onClick={() => setDetailOpen((open) => !open)}
        type="button"
      >
        {detailOpen ? <ChevronDown aria-hidden className="size-4" /> : <ChevronUp aria-hidden className="size-4" />}
      </button>

      <div
        className={cn("col-span-3 row-start-2 min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-1", collapsible ?? "flex")}
        data-layout-box="footer-detail"
        id={detailId}
        style={detailStyle}
      >
        <p className="text-xs text-on-surface-variant sm:hidden">
          {readLabel} {readText}
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
          {pricesIncludeTax ? " · precios con IVA incluido" : ""}
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

      <div
        className={cn(
          "col-span-3 row-start-3 justify-self-start sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1",
          collapsible ?? "flex",
        )}
      >
        <Button data-guarded-activation data-testid="invoice-review-discard-scan" onClick={onDiscard} variant="ghost">
          Descartar escaneo
        </Button>
      </div>

      {totals.difference !== undefined ? (
        <label
          className="col-span-3 row-start-4 flex items-center gap-2 text-xs text-foreground sm:col-span-1 sm:col-start-1 sm:row-start-3"
          data-testid="invoice-review-confirm-difference"
        >
          <input
            checked={state.acceptedDifference === totals.difference}
            className="size-4 rounded border-border"
            onChange={(event) => onAction({ type: "confirmTotalsDifference", confirmed: event.target.checked })}
            type="checkbox"
          />
          {`Cargar con una diferencia de ${money(totals.difference)} frente al ${sourceCopy.against}`}
        </label>
      ) : null}
    </footer>
  );
}
