"use client";

import { CheckCircle, Receipt } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { formatRefUsd, formatVesBs, refToVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { purchaseInlineInputClassName } from "../utils/purchaseCreateStyles";
import { PurchaseCreateSectionCard } from "./PurchaseCreateSectionCard";

type PurchaseSummaryCardProps = {
  discountRef: number;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onDiscountChange: (value: number) => void;
  rateVes: number;
  subtotalRef: number;
  taxPercentLabel?: string;
  taxRef: number;
};

export function PurchaseSummaryCard({
  discountRef,
  isSubmitting = false,
  onConfirm,
  onDiscountChange,
  rateVes,
  subtotalRef,
  taxPercentLabel = "16%",
  taxRef,
}: PurchaseSummaryCardProps) {
  const totalRef = Math.max(0, subtotalRef - discountRef + taxRef);
  const totalVes = refToVes(totalRef, rateVes);

  return (
    <PurchaseCreateSectionCard icon={Receipt} title="Resumen de Compra">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm text-on-surface-variant">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatRefUsd(subtotalRef)}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-on-surface-variant">
          <span>Descuento</span>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">-</span>
            <input
              aria-label="Descuento REF"
              className={cn(
                purchaseInlineInputClassName,
                "h-6 w-24 border-0 border-b border-border/50 bg-transparent px-1 text-right shadow-none focus:ring-0",
              )}
              min={0}
              onChange={(event) => onDiscountChange(Math.max(0, Number(event.target.value) || 0))}
              step="0.01"
              type="number"
              value={discountRef}
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-sm text-on-surface-variant">
          <span>Impuestos ({taxPercentLabel})</span>
          <span className="tabular-nums">{formatRefUsd(taxRef)}</span>
        </div>
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3 dark:border-slate-800">
          <div className="flex items-end justify-between">
            <span className="text-lg font-bold text-foreground">Total REF</span>
            <span className="text-xl font-bold text-primary tabular-nums">
              {formatRefUsd(totalRef)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-on-surface-variant">
            <span>Total VES</span>
            <span className="font-medium tabular-nums">{formatVesBs(totalVes)}</span>
          </div>
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
