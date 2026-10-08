"use client";

import { CheckCircle, Receipt } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type { PurchaseCostCurrency } from "../types";
import { purchaseInlineInputClassName } from "../utils/purchaseCreateStyles";
import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";

type PurchaseSummaryCardProps = {
  /** Moneda en la que se teclean los costos de TODAS las líneas de la compra. */
  costCurrency: PurchaseCostCurrency;
  discountRef: number;
  discountVes: number;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCostCurrencyChange: (currency: PurchaseCostCurrency) => void;
  onDiscountChange: (value: number) => void;
  subtotalRef: number;
  subtotalVes: number;
  taxPercentLabel?: string;
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
  costCurrency,
  discountRef,
  discountVes,
  isSubmitting = false,
  onConfirm,
  onCostCurrencyChange,
  onDiscountChange,
  subtotalRef,
  subtotalVes,
  taxPercentLabel = "16%",
  taxRef,
  taxVes,
}: PurchaseSummaryCardProps) {
  const totalRef = Math.max(0, roundMoney(subtotalRef - discountRef + taxRef));
  const totalVes = Math.max(0, roundMoney(subtotalVes - discountVes + taxVes));

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
              <input
                aria-label="Descuento REF"
                className={cn(
                  purchaseInlineInputClassName,
                  "h-6 w-24 border-0 border-b border-border/50 bg-transparent px-1 text-right shadow-none focus:ring-0",
                )}
                min={0}
                onChange={(event) =>
                  onDiscountChange(Math.max(0, Number(event.target.value) || 0))
                }
                step="0.01"
                type="number"
                value={discountRef}
              />
            </div>
            <span className="text-xs tabular-nums text-on-surface-variant">
              - {formatVesBs(discountVes)}
            </span>
          </div>
        </div>
        <SummaryRow
          costCurrency={costCurrency}
          label={`Impuestos (${taxPercentLabel})`}
          refAmount={taxRef}
          vesAmount={taxVes}
        />
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

      <Button
        className="mt-4 w-full gap-2"
        disabled={isSubmitting}
        onClick={onConfirm}
        type="button"
      >
        <CheckCircle aria-hidden className="size-5" />
        {isSubmitting ? "Confirmando..." : "Confirmar Compra"}
      </Button>
    </PurchaseCreateSectionCard>
  );
}
