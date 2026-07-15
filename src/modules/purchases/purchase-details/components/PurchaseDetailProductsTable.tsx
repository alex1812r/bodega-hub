import { Package } from "lucide-react";

import type { PurchaseItemMock, ProductMock } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { PurchaseDetailSectionCard } from "./PurchaseDetailSectionCard";

export type PurchaseDetailItemRow = PurchaseItemMock & {
  product?: Pick<ProductMock, "name" | "sku">;
};

type PurchaseDetailProductsTableProps = {
  items: PurchaseDetailItemRow[];
  totalRef: number;
};

export function PurchaseDetailProductsTable({
  items,
  totalRef,
}: PurchaseDetailProductsTableProps) {
  return (
    <PurchaseDetailSectionCard title="Ítems de la compra">
      {items.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-on-surface-variant">
          Esta compra no tiene productos registrados.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-container-low text-xs font-semibold uppercase tracking-wider text-on-surface-variant dark:border-slate-800">
                <th className="px-6 py-3">Producto</th>
                <th className="px-6 py-3">Cantidad</th>
                <th className="px-6 py-3 text-right">Costo unit. (REF)</th>
                <th className="px-6 py-3 text-right">Subtotal (REF)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 dark:divide-slate-800">
              {items.map((item, index) => (
                <tr
                  className={cn(
                    "transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50",
                    index % 2 === 1 && "bg-surface-bright/30 dark:bg-slate-800/20",
                  )}
                  key={`${item.purchaseId}-${item.productId}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container text-on-surface-variant dark:bg-slate-800">
                        <Package aria-hidden className="size-[1.125rem]" />
                      </div>
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
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 tabular-nums text-foreground">
                    {item.quantity} un
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm tabular-nums">
                    {formatRefUsd(item.unitCostRef)}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatRefUsd(item.subtotalRef)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-surface-container-low dark:border-slate-800">
              <tr>
                <td
                  className="px-6 py-4 text-right text-sm font-medium text-on-surface-variant"
                  colSpan={3}
                >
                  Total REF:
                </td>
                <td className="px-6 py-4 text-right text-lg font-bold tabular-nums text-foreground">
                  {formatRefUsd(totalRef)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </PurchaseDetailSectionCard>
  );
}
