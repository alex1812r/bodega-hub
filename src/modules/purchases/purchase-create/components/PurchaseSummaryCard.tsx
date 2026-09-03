"use client";

import { CheckCircle, Receipt } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { purchaseInlineInputClassName } from "../utils/purchaseCreateStyles";
import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";

type PurchaseSummaryCardProps = {
  discountRef: number;
  discountVes: number;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onDiscountChange: (value: number) => void;
  subtotalRef: number;
  subtotalVes: number;
  taxPercentLabel?: string;
  taxRef: number;
  taxVes: number;
};

/** Fila con el monto en Bs arriba y su equivalente REF debajo, igual que las lineas. */
function SummaryRow({
  emphasize = false,
  label,
  refAmount,
  vesAmount,
}: {
  emphasize?: boolean;
  label: string;
  refAmount: number;
  vesAmount: number;
}) {
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
          {formatVesBs(vesAmount)}
        </span>
        <span
          className={cn(
            "tabular-nums text-on-surface-variant",
            emphasize ? "text-sm font-medium" : "text-xs",
          )}
        >
          {formatRefUsd(refAmount)}
        </span>
      </div>
    </div>
  );
}

export function PurchaseSummaryCard({
  discountRef,
  discountVes,
  isSubmitting = false,
  onConfirm,
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
        <SummaryRow label="Subtotal" refAmount={subtotalRef} vesAmount={subtotalVes} />
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
          label={`Impuestos (${taxPercentLabel})`}
          refAmount={taxRef}
          vesAmount={taxVes}
        />
        <div className="mt-2 border-t border-border pt-3 dark:border-slate-800">
          <SummaryRow emphasize label="Total" refAmount={totalRef} vesAmount={totalVes} />
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
