"use client";

import { AlertTriangle, CheckCircle, Receipt } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/shared/components/Button";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type {
  PurchaseCostCurrency,
  PurchaseEditedLineSummary,
  PurchaseTaxBreakdownRow,
} from "../types";
import { purchaseInlineInputClassName } from "../utils/purchaseCreateStyles";
import { formatEditedLinesCount } from "../utils/purchaseLineReview";
import type { PurchaseLineScan } from "../utils/purchaseLineScan";
import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";
import { PurchaseLineNumberCell } from "./PurchaseLineNumberCell";

/** El servidor no lo impide (deja el total en 0): la pantalla no deja confirmar así. */
export const PURCHASE_DISCOUNT_OVER_SUBTOTAL_MESSAGE =
  "El descuento no puede superar el subtotal de la compra.";

export function isPurchaseDiscountOverSubtotal(discountRef: number, subtotalRef: number) {
  return discountRef > subtotalRef;
}

/** Título del aviso de Confirmar; debajo va el motivo. */
export const PURCHASE_CONFIRM_ERROR_TITLE = "No pudimos registrar la compra";

type PurchaseSummaryCardProps = {
  /**
   * Por qué no se registró la compra (validación propia, respuesta del servidor o red).
   * Se muestra junto al botón, que es donde mira quien acaba de pulsarlo, y se trae a la
   * vista al aparecer.
   */
  confirmError?: string | null;
  /**
   * Otro aviso de la pantalla ya anuncia ese mismo texto (el del pago, en «Pagar ahora»):
   * aquí se ve, pero sin `role="alert"`, para que un lector de pantalla no lo lea dos veces.
   */
  confirmErrorAnnounced?: boolean;
  /** Cambia en cada intento de confirmar: el mismo error repetido vuelve a traerse a la vista. */
  confirmErrorAttempt?: number;
  /** Moneda en la que se teclean los costos de TODAS las líneas de la compra. */
  costCurrency: PurchaseCostCurrency;
  discountRef: number;
  discountVes: number;
  /** Líneas editadas tras ser agregadas (`getEditedLinesSummary`): se listan para revisarlas antes de confirmar. */
  editedLines?: PurchaseEditedLineSummary[];
  /**
   * La compra ya se creó y la página espera a que la navegación al detalle la desmonte:
   * el botón queda deshabilitado para no registrar otra.
   */
  isConfirmed?: boolean;
  /** Envío en vuelo: botón deshabilitado y `aria-busy`. */
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCostCurrencyChange: (currency: PurchaseCostCurrency) => void;
  onDiscountChange: (value: number) => void;
  /**
   * Un lector escribió su código en Descuento (8 o más dígitos enteros y Enter): no es
   * un descuento, se resuelve como un escaneo del buscador.
   */
  onDiscountScan?: (scan: PurchaseLineScan) => void;
  subtotalRef: number;
  subtotalVes: number;
  /** Base e IVA por cada alícuota presente en la compra (`buildPurchaseTaxBreakdown`). */
  taxBreakdown: PurchaseTaxBreakdownRow[];
  /** IVA total de la compra: es el que entra en el Total; el desglose suma lo mismo. */
  taxRef: number;
  taxVes: number;
};

const COST_CURRENCY_OPTIONS: ReadonlyArray<{ label: string; value: PurchaseCostCurrency }> = [
  { label: "REF", value: "ref" },
  { label: "Bs", value: "ves" },
];

/** Un solo selector para toda la compra: las líneas ya no eligen moneda. */
function CostCurrencyToggle({
  onChange,
  value,
}: {
  onChange: (currency: PurchaseCostCurrency) => void;
  value: PurchaseCostCurrency;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-on-surface-variant" id="purchase-cost-currency-label">
        Costos en
      </span>
      <div
        aria-labelledby="purchase-cost-currency-label"
        className="inline-flex shrink-0 rounded-md border border-border p-0.5"
        role="group"
      >
        {COST_CURRENCY_OPTIONS.map((option) => {
          const active = value === option.value;

          return (
            <button
              aria-pressed={active}
              className={cn(
                "min-h-8 min-w-12 cursor-pointer rounded px-3 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-on-surface-variant hover:bg-surface-container-low",
              )}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Fila con el monto en la moneda de la compra arriba y su equivalente debajo, igual que las líneas. */
function SummaryRow({
  costCurrency,
  emphasize = false,
  label,
  refAmount,
  vesAmount,
}: {
  costCurrency: PurchaseCostCurrency;
  emphasize?: boolean;
  label: string;
  refAmount: number;
  vesAmount: number;
}) {
  const refText = formatRefUsd(refAmount);
  const vesText = formatVesBs(vesAmount);

  return (
    <div className="flex items-start justify-between gap-3">
      <span
        className={cn(
          "text-sm",
          emphasize ? "font-bold text-foreground" : "text-on-surface-variant",
        )}
      >
        {label}
      </span>
      <div className="flex flex-col items-end leading-tight">
        <span
          className={cn(
            "tabular-nums",
            emphasize ? "text-xl font-bold text-primary" : "text-sm text-foreground",
          )}
        >
          {costCurrency === "ves" ? vesText : refText}
        </span>
        <span
          className={cn(
            "tabular-nums text-on-surface-variant",
            emphasize ? "text-sm font-medium" : "text-xs",
          )}
        >
          {costCurrency === "ves" ? refText : vesText}
        </span>
      </div>
    </div>
  );
}

export function PurchaseSummaryCard({
  confirmError = null,
  confirmErrorAnnounced = false,
  confirmErrorAttempt = 0,
  costCurrency,
  discountRef,
  discountVes,
  editedLines = [],
  isConfirmed = false,
  isSubmitting = false,
  onConfirm,
  onCostCurrencyChange,
  onDiscountChange,
  onDiscountScan,
  subtotalRef,
  subtotalVes,
  taxBreakdown,
  taxRef,
  taxVes,
}: PurchaseSummaryCardProps) {
  const discountOverSubtotal = isPurchaseDiscountOverSubtotal(discountRef, subtotalRef);
  const totalRef = Math.max(0, roundMoney(subtotalRef - discountRef + taxRef));
  const totalVes = Math.max(0, roundMoney(subtotalVes - discountVes + taxVes));
  const confirmErrorRef = useRef<HTMLDivElement>(null);
  // El aviso del descuento junto a su campo ya anuncia ese mismo texto.
  const alreadyAnnounced =
    confirmErrorAnnounced ||
    (discountOverSubtotal && confirmError === PURCHASE_DISCOUNT_OVER_SUBTOTAL_MESSAGE);

  useEffect(() => {
    const notice = confirmErrorRef.current;

    // jsdom no implementa `scrollIntoView`.
    if (confirmError && notice && typeof notice.scrollIntoView === "function") {
      notice.scrollIntoView({ block: "nearest" });
    }
  }, [confirmError, confirmErrorAttempt]);

  return (
    <PurchaseCreateSectionCard icon={Receipt} title="Resumen de Compra">
      <div className="flex flex-col gap-3">
        <CostCurrencyToggle onChange={onCostCurrencyChange} value={costCurrency} />
        <SummaryRow
          costCurrency={costCurrency}
          label="Subtotal"
          refAmount={subtotalRef}
          vesAmount={subtotalVes}
        />
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-on-surface-variant">Descuento</span>
          <div className="flex flex-col items-end leading-tight">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">-</span>
              <span className="text-xs text-on-surface-variant">ref</span>
              {/* La misma celda segura que los costos de las líneas: un código leído aquí no queda como descuento. */}
              <PurchaseLineNumberCell
                aria-label="Descuento REF"
                className={cn(
                  purchaseInlineInputClassName,
                  "h-6 w-24 rounded-none border-0 border-b border-border/50 bg-transparent px-1 text-right shadow-none focus:ring-0",
                )}
                onChange={onDiscountChange}
                onScan={onDiscountScan}
                scanNoticeSubject="el descuento"
                value={discountRef}
              />
            </div>
            <span className="text-xs tabular-nums text-on-surface-variant">
              - {formatVesBs(discountVes)}
            </span>
          </div>
        </div>
        {discountOverSubtotal ? (
          <p className="text-right text-xs font-medium text-destructive" role="alert">
            {PURCHASE_DISCOUNT_OVER_SUBTOTAL_MESSAGE}
          </p>
        ) : null}
        {taxBreakdown.length > 0 ? (
          <div
            aria-label="Desglose de IVA por alícuota"
            className="flex flex-col gap-3"
            role="group"
          >
            {taxBreakdown.map((row) => (
              <div className="flex flex-col gap-3" key={row.key}>
                <SummaryRow
                  costCurrency={costCurrency}
                  label={`Base ${row.label}`}
                  refAmount={row.baseRef}
                  vesAmount={row.baseVes}
                />
                <SummaryRow
                  costCurrency={costCurrency}
                  label={`IVA ${row.label}`}
                  refAmount={row.taxRef}
                  vesAmount={row.taxVes}
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-2 border-t border-border pt-3 dark:border-slate-800">
          <SummaryRow
            costCurrency={costCurrency}
            emphasize
            label="Total"
            refAmount={totalRef}
            vesAmount={totalVes}
          />
        </div>
      </div>

      {editedLines.length > 0 ? (
        <div
          aria-label="Líneas editadas"
          className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
          role="group"
        >
          <p className="text-xs font-semibold text-foreground">
            {formatEditedLinesCount(editedLines.length)}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {editedLines.map((line) => (
              <li className="text-xs break-words text-on-surface-variant" key={line.itemId}>
                <span className="font-medium text-foreground">{line.name}</span> · {line.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {confirmError ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
          ref={confirmErrorRef}
          role={alreadyAnnounced ? undefined : "alert"}
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{PURCHASE_CONFIRM_ERROR_TITLE}</p>
            <p className="text-sm break-words">{confirmError}</p>
          </div>
        </div>
      ) : null}

      <Button
        aria-busy={isSubmitting}
        className="mt-4 w-full gap-2"
        disabled={isSubmitting || isConfirmed}
        onClick={onConfirm}
        type="button"
      >
        <CheckCircle aria-hidden className="size-5" />
        {isConfirmed
          ? "Compra registrada..."
          : isSubmitting
            ? "Confirmando..."
            : "Confirmar Compra"}
      </Button>
    </PurchaseCreateSectionCard>
  );
}
