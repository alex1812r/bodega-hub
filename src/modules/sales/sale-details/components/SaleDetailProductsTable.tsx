import { Package } from "lucide-react";
import Link from "next/link";

import type { SaleItemWithProduct } from "../../hooks/useSales";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";
import { withChainedReturnTo } from "@/shared/utils/returnTo";

type SaleDetailProductsTableProps = {
  /** El rol puede ver productos: el nombre de cada renglón enlaza a su detalle. */
  canViewProducts?: boolean;
  /** URL actual del detalle de la venta, con su `returnTo`: a ella vuelve el producto. */
  detailUrl?: string;
  items: SaleItemWithProduct[];
};

/** Renglones de la venta; va dentro de la sección "Productos" del detalle. */
export function SaleDetailProductsTable({
  canViewProducts = false,
  detailUrl,
  items,
}: SaleDetailProductsTableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-on-surface-variant dark:border-slate-800">
            <th className="px-4 py-3">Producto</th>
            <th className="px-4 py-3 text-right">Cant.</th>
            <th className="px-4 py-3 text-right">Precio (REF)</th>
            <th className="px-4 py-3 text-right">Subtotal (REF)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-slate-800">
          {items.map((item, index) => (
            <tr
              className={cn(
                "transition-colors hover:bg-surface-bright dark:hover:bg-slate-800/50",
                index % 2 === 1 && "bg-surface-bright/30 dark:bg-slate-800/20",
              )}
              key={`${item.saleId}-${item.productId}`}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-container text-on-surface-variant dark:bg-slate-800">
                    <Package aria-hidden className="size-[1.125rem]" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {canViewProducts && item.productId ? (
                        <Link
                          className="rounded hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={withChainedReturnTo(
                            `/products/${encodeURIComponent(item.productId)}`,
                            detailUrl,
                          )}
                        >
                          {item.product?.name ?? item.productId}
                        </Link>
                      ) : (
                        (item.product?.name ?? item.productId)
                      )}
                    </p>
                    {item.product?.sku ? (
                      <p className="text-xs text-on-surface-variant">SKU: {item.product.sku}</p>
                    ) : null}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
              <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                {formatRefUsd(item.unitPriceRef)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm font-medium tabular-nums">
                {formatRefUsd(item.subtotalRef)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
