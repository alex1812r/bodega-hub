"use client";

import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { PurchaseItemMock, ProductMock } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { PurchaseDetailSectionCard } from "./PurchaseDetailSectionCard";

export type PurchaseDetailItemRow = PurchaseItemMock & {
  product?: Pick<ProductMock, "imageUrl" | "name" | "sku">;
};

type PurchaseDetailProductsTableProps = {
  discountRef: number;
  discountVes: number;
  items: PurchaseDetailItemRow[];
  taxRef: number;
  taxVes: number;
  totalRef: number;
  totalVes: number;
};

function DualMoneyCell({
  refAmount,
  vesAmount,
  emphasize = false,
  muted = false,
}: {
  emphasize?: boolean;
  muted?: boolean;
  refAmount: number;
  vesAmount: number;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 leading-tight">
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          emphasize ? "font-semibold text-foreground" : "text-foreground",
          muted && "text-on-surface-variant",
        )}
      >
        {formatVesBs(vesAmount)}
      </span>
      <span className="font-mono text-xs tabular-nums text-on-surface-variant">
        {formatRefUsd(refAmount)}
      </span>
    </div>
  );
}

function FooterLabelCell({ children }: { children: ReactNode }) {
  return (
    <td
      className="px-6 py-2.5 text-right text-xs font-medium text-on-surface-variant"
      colSpan={5}
    >
      {children}
    </td>
  );
}

function ProductThumb({
  alt,
  imageUrl,
}: {
  alt: string;
  imageUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <div className="relative flex size-10 shrink-0 overflow-hidden rounded bg-surface-container text-on-surface-variant dark:bg-slate-800">
      {showImage ? (
        // Native img: avoids next/image remote config for many tiny table thumbs.
        // eslint-disable-next-line @next/next/no-img-element -- purchase line thumbs are unoptimized remote URLs
        <img
          alt={alt}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
          src={imageUrl!}
        />
      ) : (
        <span className="flex size-full items-center justify-center">
          <Package aria-hidden className="size-[1.125rem] opacity-60" />
        </span>
      )}
    </div>
  );
}

function lineTaxRef(item: PurchaseDetailItemRow): number {
  if (item.taxRef != null) return item.taxRef;
  if (item.taxRate != null && item.taxRate > 0) {
    return Math.round(item.subtotalRef * (item.taxRate / 100) * 100) / 100;
  }
  return 0;
}

function lineTaxVes(item: PurchaseDetailItemRow): number {
  if (item.taxVes != null) return item.taxVes;
  if (item.taxRate != null && item.taxRate > 0) {
    return Math.round(item.subtotalVes * (item.taxRate / 100) * 100) / 100;
  }
  return 0;
}

export function PurchaseDetailProductsTable({
  discountRef,
  discountVes,
  items,
  taxRef,
  taxVes,
  totalRef,
  totalVes,
}: PurchaseDetailProductsTableProps) {
  const subtotalRef = Math.round(items.reduce((sum, item) => sum + item.subtotalRef, 0) * 100) / 100;
  const subtotalVes = Math.round(items.reduce((sum, item) => sum + item.subtotalVes, 0) * 100) / 100;
  const linesTaxRef =
    taxRef ||
    Math.round(items.reduce((sum, item) => sum + lineTaxRef(item), 0) * 100) / 100;
  const linesTaxVes =
    taxVes ||
    Math.round(items.reduce((sum, item) => sum + lineTaxVes(item), 0) * 100) / 100;
  const linesTotalRef = Math.round((subtotalRef + linesTaxRef) * 100) / 100;
  const linesTotalVes = Math.round((subtotalVes + linesTaxVes) * 100) / 100;
  const hasDiscount = discountVes > 0 || discountRef > 0;

  return (
    <PurchaseDetailSectionCard title="Ítems de la compra">
      {items.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-on-surface-variant">
          Esta compra no tiene productos registrados.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-container-low text-xs font-semibold uppercase tracking-wider text-on-surface-variant dark:border-slate-800">
                <th className="px-6 py-3">Producto</th>
                <th className="px-6 py-3">Cantidad</th>
                <th className="px-6 py-3 text-right">Costo unit. (sin impuesto)</th>
                <th className="px-6 py-3 text-right">Costo unit. (con impuesto)</th>
                <th className="px-6 py-3 text-right">Subtotal</th>
                <th className="px-6 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 dark:divide-slate-800">
              {items.map((item, index) => {
                const taxRefLine = lineTaxRef(item);
                const taxVesLine = lineTaxVes(item);
                const withTaxRef = Math.round((item.subtotalRef + taxRefLine) * 100) / 100;
                const withTaxVes = Math.round((item.subtotalVes + taxVesLine) * 100) / 100;
                const taxRate = item.taxRate ?? 0;
                const unitWithTaxRef =
                  Math.round(item.unitCostRef * (1 + taxRate / 100) * 100) / 100;
                const unitWithTaxVes =
                  Math.round(item.unitCostVes * (1 + taxRate / 100) * 100) / 100;

                return (
                  <tr
                    className={cn(
                      "transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50",
                      index % 2 === 1 && "bg-surface-bright/30 dark:bg-slate-800/20",
                    )}
                    key={`${item.purchaseId}-${item.productId}-${item.entryMode ?? "line"}-${index}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb
                          alt={item.product?.name ?? "Producto"}
                          imageUrl={item.product?.imageUrl}
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">
                            {item.product?.name ?? item.productId}
                          </p>
                          {item.product?.sku ? (
                            <p className="text-xs text-on-surface-variant">
                              SKU: {item.product.sku}
                            </p>
                          ) : null}
                          {item.entryMode === "pack" &&
                          item.packCount &&
                          item.packLabel &&
                          item.unitsPerPack ? (
                            <p className="text-xs text-on-surface-variant">
                              {item.packCount} {item.packLabel}
                              {item.packCount > 1 ? "s" : ""} × {item.unitsPerPack} u
                              {item.packCostRef != null
                                ? ` @ ${formatRefUsd(item.packCostRef)}`
                                : ""}
                              {taxRate > 0 ? ` · IVA ${taxRate}%` : ""}
                            </p>
                          ) : item.entryMode === "unit" ? (
                            <p className="text-xs text-on-surface-variant">
                              Por unidad
                              {taxRate > 0 ? ` · IVA ${taxRate}%` : ""}
                            </p>
                          ) : taxRate > 0 ? (
                            <p className="text-xs text-on-surface-variant">
                              IVA {taxRate}%
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 tabular-nums text-foreground">
                      {item.quantity} un
                    </td>
                    <td className="px-6 py-4">
                      <DualMoneyCell
                        refAmount={item.unitCostRef}
                        vesAmount={item.unitCostVes}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <DualMoneyCell
                        refAmount={unitWithTaxRef}
                        vesAmount={unitWithTaxVes}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <DualMoneyCell
                        refAmount={item.subtotalRef}
                        vesAmount={item.subtotalVes}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <DualMoneyCell
                        emphasize
                        refAmount={withTaxRef}
                        vesAmount={withTaxVes}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border bg-surface-container-low dark:border-slate-800">
              <tr>
                <FooterLabelCell>Subtotal (sin impuesto)</FooterLabelCell>
                <td className="px-6 py-2.5">
                  <DualMoneyCell muted refAmount={subtotalRef} vesAmount={subtotalVes} />
                </td>
              </tr>
              <tr>
                <FooterLabelCell>Impuesto</FooterLabelCell>
                <td className="px-6 py-2.5">
                  <DualMoneyCell muted refAmount={linesTaxRef} vesAmount={linesTaxVes} />
                </td>
              </tr>
              <tr>
                <FooterLabelCell>Suma de líneas (con impuesto)</FooterLabelCell>
                <td className="px-6 py-2.5">
                  <DualMoneyCell refAmount={linesTotalRef} vesAmount={linesTotalVes} />
                </td>
              </tr>
              {hasDiscount ? (
                <tr>
                  <FooterLabelCell>Descuento aplicado</FooterLabelCell>
                  <td className="px-6 py-2.5">
                    <DualMoneyCell
                      muted
                      refAmount={-Math.abs(discountRef)}
                      vesAmount={-Math.abs(discountVes)}
                    />
                  </td>
                </tr>
              ) : null}
              <tr className="border-t border-border/80 dark:border-slate-700">
                <td
                  className="px-6 py-4 text-right text-sm font-semibold text-foreground"
                  colSpan={5}
                >
                  Total compra
                </td>
                <td className="px-6 py-4">
                  <DualMoneyCell emphasize refAmount={totalRef} vesAmount={totalVes} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </PurchaseDetailSectionCard>
  );
}
