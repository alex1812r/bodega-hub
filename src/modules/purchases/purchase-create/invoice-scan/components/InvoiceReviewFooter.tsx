"use client";

import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { type ChangeEvent, type CSSProperties, type Ref, useId, useLayoutEffect, useRef, useState } from "react";

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
  /** D54(a): alto mínimo del pie entero con el layout pendiente. */
  footerStyle?: CSSProperties;
  /** REP12-01 (D52): aviso de factura duplicada sin reconocer; Cargar lo exige. */
  duplicateUnacknowledged?: boolean;
  /** REP12-01: consulta de duplicados vigente sin respuesta; Cargar espera. */
  duplicatePending?: boolean;
  /** REP12-01: el motivo «Marca el aviso…» lleva a la casilla del aviso. */
  onReviewDuplicate?: () => void;
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
 * D54(a) (C12B-M1): con cifra leída, el sitio de la casilla está reservado siempre (arriba en móvil,
 * bajo el detalle desde `sm`, a la izquierda) y «Cargar» va pegado al borde de abajo: que aparezca
 * la diferencia no cambia el alto del pie ni pone la casilla donde estaba «Cargar». La casilla solo
 * cambia con su propio control (el texto no es su etiqueta) y, con el puntero, con una pulsación que
 * empezó y terminó en ella después de su último cambio de sitio.
 */
const READ_LABELS: Record<NonNullable<InvoiceReviewTotals["readSource"]>, { label: string; against: string }> = {
  total: { label: "Leído", against: "total leído" },
  subtotalPlusTax: { label: "Subtotal + IVA leídos", against: "subtotal + IVA leídos" },
  subtotal: { label: "Subtotal leído", against: "subtotal leído (base sin IVA)" },
  tax: { label: "IVA leído", against: "IVA leído" },
};

export function InvoiceReviewFooter({
  detailStyle,
  duplicatePending = false,
  duplicateUnacknowledged = false,
  footerRef,
  footerStyle,
  onAction,
  onDiscard,
  onLoad,
  onReviewDuplicate,
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
  const differenceTextId = useId();
  const differenceRef = useRef<HTMLInputElement>(null);
  // D54(a)(3): sitio de la casilla y desde cuándo está ahí; pulsación del puntero sobre ella.
  const differencePlaceRef = useRef<{ top: number; left: number; at: number } | null>(null);
  const differencePressRef = useRef<{ pointerId: number; at: number; released: boolean } | null>(null);

  // Al aparecer o moverse la casilla, una pulsación que ya estaba en curso deja de contar.
  useLayoutEffect(() => {
    const input = differenceRef.current;
    if (!input) {
      differencePlaceRef.current = null;
      return;
    }
    const { top, left } = input.getBoundingClientRect();
    const place = differencePlaceRef.current;
    if (!place || Math.abs(place.top - top) >= 1 || Math.abs(place.left - left) >= 1) {
      differencePlaceRef.current = { top, left, at: Date.now() };
      differencePressRef.current = null;
    }
  });

  function handleDifferenceChange(event: ChangeEvent<HTMLInputElement>) {
    const press = differencePressRef.current;
    differencePressRef.current = null;
    // Con el puntero (clic con `detail` ≥ 1) solo vale una pulsación completa sobre la casilla desde
    // su último cambio de sitio; el teclado (Espacio) no tiene punto bajo el dedo.
    const native = event.nativeEvent;
    if (native instanceof MouseEvent && native.detail > 0) {
      const placedAt = differencePlaceRef.current?.at ?? 0;
      if (!press || !press.released || press.at < placedAt) {
        return;
      }
    }
    onAction({ type: "confirmTotalsDifference", confirmed: event.target.checked });
  }
  // REP12-01: motivos del duplicado junto a los bloqueos (mientras se comprueba, solo ese).
  const duplicateReason = duplicatePending ? "pending" : duplicateUnacknowledged ? "unacknowledged" : null;

  return (
    <footer
      aria-label="Resumen de la revisión"
      ref={footerRef}
      className="sticky bottom-0 z-10 grid grid-cols-[minmax(0,1fr)_auto_auto] content-start items-center gap-x-2 gap-y-1 border-t border-border bg-surface-container-lowest px-4 py-2 text-sm shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-x-3 sm:py-3 dark:border-slate-800"
      // D36: contenedor neutro que recibe el foco al no quedar pendientes (Tab sigue a Cargar);
      // Espacio sobre él no desplaza la página (como en las filas, B6-1).
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === " ") {
          event.preventDefault();
        }
      }}
      tabIndex={-1}
      // D54(a): retenido como las filas; lo que aparece o se mueve en él queda guardado 1 s.
      data-layout-box="footer"
      data-layout-shift-guard
      style={footerStyle}
    >
      {/* D54(a): en móvil, dos líneas reservadas (con la diferencia el total pasa a dos y empujaría «Cargar»). */}
      <p
        className="col-start-1 row-start-2 flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:row-start-1 sm:min-h-0"
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
        className="col-start-2 row-start-2 self-end sm:col-start-3 sm:row-span-3 sm:row-start-1"
        data-load-button
        disabled={!summary.canLoad || duplicatePending || duplicateUnacknowledged}
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
        className="col-start-3 row-start-2 inline-flex size-9 cursor-pointer self-end items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        onClick={() => setDetailOpen((open) => !open)}
        type="button"
      >
        {detailOpen ? <ChevronDown aria-hidden className="size-4" /> : <ChevronUp aria-hidden className="size-4" />}
      </button>

      <div
        className={cn(
          "col-span-3 row-start-3 min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-1 sm:row-start-2",
          collapsible ?? "flex",
        )}
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
        {summary.blockers.length > 0 || duplicateReason ? (
          <ul aria-live="polite" className="text-xs text-on-surface-variant" data-testid="invoice-review-blockers">
            {summary.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
            {duplicateReason === "pending" ? <li>Comprobando duplicados…</li> : null}
            {duplicateReason === "unacknowledged" ? (
              <li>
                <button
                  className="cursor-pointer text-left underline underline-offset-2 hover:text-foreground"
                  data-guarded-activation
                  onClick={onReviewDuplicate}
                  type="button"
                >
                  Marca el aviso de factura duplicada.
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <div
        className={cn(
          "col-span-3 row-start-4 justify-self-start sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1",
          collapsible ?? "flex",
        )}
      >
        <Button data-guarded-activation data-testid="invoice-review-discard-scan" onClick={onDiscard} variant="ghost">
          Descartar escaneo
        </Button>
      </div>

      {totals.read !== undefined ? (
        // D54(a): sitio reservado aunque no haya diferencia; a la izquierda, nunca bajo «Cargar».
        <div
          className="col-span-3 row-start-1 min-h-8 min-w-0 text-xs text-foreground sm:col-span-1 sm:col-start-1 sm:row-start-3 lg:min-h-4"
          data-testid="invoice-review-difference-slot"
        >
          {totals.difference !== undefined ? (
            <div className="flex items-start gap-2" data-testid="invoice-review-confirm-difference">
              <input
                aria-labelledby={differenceTextId}
                checked={state.acceptedDifference === totals.difference}
                className="size-4 shrink-0 rounded border-border"
                onChange={handleDifferenceChange}
                onPointerDown={(event) => {
                  differencePressRef.current = { pointerId: event.pointerId, at: Date.now(), released: false };
                }}
                onPointerUp={(event) => {
                  const press = differencePressRef.current;
                  if (press?.pointerId === event.pointerId) {
                    differencePressRef.current = { ...press, released: true };
                  }
                }}
                ref={differenceRef}
                type="checkbox"
              />
              <span id={differenceTextId}>
                {`Cargar con una diferencia de ${money(totals.difference)} frente al ${sourceCopy.against}`}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}
