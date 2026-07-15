import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { ProductDetailSectionCard } from "./ProductDetailSectionCard";

export type ProductPriceHistoryRow = {
  changedBy: string;
  date: string;
  id: string;
  newPriceRef: number;
  oldPriceRef: number;
  reason: string;
};

type ProductDetailPriceHistoryTableProps = {
  rows: ProductPriceHistoryRow[];
};

export function ProductDetailPriceHistoryTable({
  rows,
}: ProductDetailPriceHistoryTableProps) {
  return (
    <ProductDetailSectionCard title="Historial de precios">
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
          Aún no hay cambios de precio registrados para este producto.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-container-low text-xs font-semibold text-on-surface-variant dark:border-slate-800">
                <th className="px-5 py-3">Fecha</th>
                <th className="px-5 py-3">Precio ant.</th>
                <th className="px-5 py-3">Nuevo precio</th>
                <th className="px-5 py-3">Usuario</th>
                <th className="px-5 py-3">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 dark:divide-slate-800">
              {rows.map((row, index) => {
                const isLatest = index === 0;

                return (
                  <tr
                    className="transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50"
                    key={row.id}
                  >
                    <td className="px-5 py-3 text-foreground">{row.date}</td>
                    <td className="px-5 py-3 text-outline line-through tabular-nums">
                      {formatRefUsd(row.oldPriceRef)}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3 font-medium tabular-nums",
                        isLatest ? "text-primary" : "text-foreground",
                      )}
                    >
                      {formatRefUsd(row.newPriceRef)}
                    </td>
                    <td className="px-5 py-3 text-foreground">{row.changedBy}</td>
                    <td className="px-5 py-3 text-on-surface-variant">{row.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ProductDetailSectionCard>
  );
}
