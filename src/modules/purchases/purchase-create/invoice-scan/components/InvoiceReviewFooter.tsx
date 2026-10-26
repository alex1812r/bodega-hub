"use client";

import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { type ChangeEvent, type CSSProperties, type Ref, useId, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

import {
  getHeaderDateMessage,
  getTaxInclusion,
  type InvoiceReviewAction,
  type InvoiceReviewState,
  type InvoiceReviewSummary,
  type InvoiceReviewTotals,
} from "../reviewModel";
import { formatInvoiceMoney, getDisplayedTotals } from "./invoiceReviewView";
import { useFreshPressCheckbox } from "./useFreshPressCheckbox";

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
  /** REP13-06 (B-qa05-2): hay aviso de duplicado (reconocido o no); su alto reservado no cambia al marcarlo. */
  duplicateWarning?: boolean;
  /** REP12-01: consulta de duplicados vigente sin respuesta; Cargar espera. */
  duplicatePending?: boolean;
  /** REP12-05 (B-qa-rep12-2): la consulta de duplicados vigente falló; no bloquea (D52), pero se dice. */
  duplicateCheckFailed?: boolean;
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
  duplicateCheckFailed = false,
  duplicatePending = false,
  duplicateUnacknowledged = false,
  duplicateWarning = false,
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
  // D54(a)(3): la casilla solo cambia con su propio control y una pulsación nueva sobre ella.
  const differenceRef = useRef<HTMLInputElement>(null);
  const difference = useFreshPressCheckbox(differenceRef);

  function handleDifferenceChange(event: ChangeEvent<HTMLInputElement>) {
    if (difference.accepts(event)) {
      onAction({ type: "confirmTotalsDifference", confirmed: event.target.checked });
    }
  }
  // REP12-01: motivos del duplicado junto a los bloqueos (mientras se comprueba, solo ese).
  const duplicateReason = duplicatePending ? "pending" : duplicateUnacknowledged ? "unacknowledged" : null;
  // REP13-06 (B-qa05-1): la fecha inválida también se dice en el pie compacto.
  const dateInvalid = getHeaderDateMessage(state) !== undefined;

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
      {/* D54(a): en móvil, dos líneas reservadas (con la diferencia el total pasa a dos y empujaría «Cargar»).
          REP12-06: con el fallo de duplicados a la vista, tres (que aparezca la diferencia no lo hace crecer).
          REP13-05: también con el aviso de duplicado por marcar. REP13-06: y con la fecha inválida; el del
          duplicado sigue reservado tras marcarlo (B-qa05-2: «Cargar» subía al quitarse el motivo). */}
      <p
        className={cn(
          "col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:row-start-1 sm:min-h-0",
          (duplicateCheckFailed || duplicateWarning || duplicateUnacknowledged || dateInvalid) && !detailOpen
            ? "min-h-16"
            : "min-h-11",
        )}
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
        {/* REP12-06 (B-qa05-1): en móvil, con el detalle plegado, el fallo de la consulta de duplicados también se ve. */}
        {duplicateCheckFailed && !detailOpen ? (
          <span className="text-xs text-amber-700 sm:hidden dark:text-amber-300">No se pudo comprobar duplicados</span>
        ) : null}
        {/* REP13-05 (B-qa23-1): el aviso que llega tarde puede quedar fuera de la vista; en móvil, con el
            detalle plegado, el motivo de bloqueo se ve y lleva a su casilla (como el del detalle). */}
        {duplicateReason === "unacknowledged" && !detailOpen ? (
          <button
            className="inline-flex min-h-6 cursor-pointer items-center text-left text-xs text-amber-700 underline underline-offset-2 hover:text-foreground sm:hidden dark:text-amber-300"
            data-guarded-activation
            onClick={onReviewDuplicate}
            type="button"
          >
            Marca el aviso de factura duplicada.
          </button>
        ) : null}
        {dateInvalid && !detailOpen ? (
          <span className="text-xs text-amber-700 sm:hidden dark:text-amber-300">Corrige la fecha de la factura.</span>
        ) : null}
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
        {summary.blockers.length > 0 || duplicateReason || duplicateCheckFailed ? (
          <ul aria-live="polite" className="text-xs text-on-surface-variant" data-testid="invoice-review-blockers">
            {summary.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
            {duplicateReason === "pending" ? <li>Comprobando duplicados…</li> : null}
            {duplicateCheckFailed ? <li>No se pudo comprobar si la factura ya se cargó.</li> : null}
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
          className="col-span-3 row-start-1 min-h-8 min-w-0 text-xs text-foreground sm:col-span-1 sm:col-start-1 sm:row-start-3 lg:min-h-6"
          data-testid="invoice-review-difference-slot"
        >
          {totals.difference !== undefined ? (
            <div className="flex items-start gap-2" data-testid="invoice-review-confirm-difference">
              {/* REP12-06: 24 px de área táctil (WCAG 2.5.8); el sitio reservado tiene su alto (lg:min-h-6). */}
              <input
                aria-labelledby={differenceTextId}
                checked={state.acceptedDifference === totals.difference}
                className="size-6 shrink-0 rounded border-border"
                onChange={handleDifferenceChange}
                onPointerDown={difference.onPointerDown}
                onPointerUp={difference.onPointerUp}
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
