"use client";

import { type ReactNode, useMemo } from "react";

import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

type ProductDetailSuppliersSummaryCardsProps = {
  rows: SupplierProduct[];
  salePriceRef: number;
};

export function ProductDetailSuppliersSummaryCards({
  rows,
  salePriceRef,
}: ProductDetailSuppliersSummaryCardsProps) {
  const activeRows = rows.filter((row) => row.isActive !== false);

  const summary = useMemo(() => {
    if (activeRows.length === 0) {
      return null;
    }

    const sorted = [...activeRows].sort(
      (first, second) => (first.lastCostRef ?? 0) - (second.lastCostRef ?? 0),
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const margin =
      salePriceRef > 0 && best?.lastCostRef != null
        ? Number((((salePriceRef - best.lastCostRef) / salePriceRef) * 100).toFixed(1))
        : null;

    return { best, margin, worst };
  }, [activeRows, salePriceRef]);

  if (!summary) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-4 border-b border-outline-variant px-5 py-4 md:grid-cols-3">
      <SummaryCard
        label="Mejor precio"
        trailing={
          <span className="text-lg font-bold tabular-nums text-secondary">
            {formatRefUsd(summary.best.lastCostRef ?? 0)}
          </span>
        }
        value={summary.best.supplier?.name ?? summary.best.supplierId}
      />
      <SummaryCard
        label="Precio más alto"
        trailing={
          <span className="text-lg font-bold tabular-nums text-error">
            {formatRefUsd(summary.worst.lastCostRef ?? 0)}
          </span>
        }
        value={summary.worst.supplier?.name ?? summary.worst.supplierId}
      />
      <SummaryCard
        accent
        label="Margen estimado"
        trailing={
          <span className="text-lg font-bold tabular-nums text-primary">
            {summary.margin != null ? `${summary.margin}%` : "—"}
          </span>
        }
        value={`Vs. Venta (${formatRefUsd(salePriceRef)})`}
      />
    </div>
  );
}

function SummaryCard({
  accent = false,
  label,
  trailing,
  value,
}: {
  accent?: boolean;
  label: string;
  trailing: ReactNode;
  value: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        accent
          ? "border-primary/20 bg-primary/5"
          : "border-outline-variant/30 bg-surface-container-low",
      )}
    >
      <span
        className={cn(
          "mb-1 block text-xs font-semibold uppercase tracking-wider",
          accent ? "text-primary" : "text-on-surface-variant",
        )}
      >
        {label}
      </span>
      <div className="flex items-end justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{value}</span>
        {trailing}
      </div>
    </div>
  );
}
