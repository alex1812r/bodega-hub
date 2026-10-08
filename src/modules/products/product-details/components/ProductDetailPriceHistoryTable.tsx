import { Badge } from "@/shared/components/Badge";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import {
  PRICE_BASELINE_REASON,
  PRICE_KEEP_REASON,
  type PriceHistoryKind,
} from "../../services/priceReview";
import { ProductDetailSectionCard } from "./ProductDetailSectionCard";

export type ProductPriceHistoryRow = {
  changedBy: string;
  date: string;
  id: string;
  /**
   * `change`: cambio de precio (anterior → nuevo). `keep`: "Mantener precio",
   * el precio no cambió. `baseline`: línea base de ganancia del producto.
   */
  kind: PriceHistoryKind;
  newPriceRef: number;
  /** `null`: la fila no registró precio anterior. */
  oldPriceRef: number | null;
  reason: string;
};

/** Motivo que el servidor pone solo en cada tipo de fila: repetirlo junto a la etiqueta no aporta. */
const DEFAULT_REASON_BY_KIND: Partial<Record<PriceHistoryKind, string>> = {
  baseline: PRICE_BASELINE_REASON,
  keep: PRICE_KEEP_REASON,
};

function HistoryReason({ kind, reason }: Pick<ProductPriceHistoryRow, "kind" | "reason">) {
  if (kind === "change") {
    return reason;
  }

  const ownReason = reason === DEFAULT_REASON_BY_KIND[kind] ? null : reason;

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {kind === "keep" ? (
        <Badge variant="info">Precio mantenido</Badge>
      ) : (
        <span className="text-xs text-outline">Línea base</span>
      )}
      {ownReason ? <span>{ownReason}</span> : null}
    </span>
  );
}

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
                    {/* Solo un cambio tiene precio anterior que tachar: en "keep" y
                        "baseline" el precio no se movió. */}
                    {row.kind === "change" && row.oldPriceRef !== null ? (
                      <td className="px-5 py-3 text-outline line-through tabular-nums">
                        {formatRefUsd(row.oldPriceRef)}
                      </td>
                    ) : (
                      <td className="px-5 py-3 text-outline">—</td>
                    )}
                    <td
                      className={cn(
                        "px-5 py-3 font-medium tabular-nums",
                        isLatest ? "text-primary" : "text-foreground",
                      )}
                    >
                      {formatRefUsd(row.newPriceRef)}
                    </td>
                    <td className="px-5 py-3 text-foreground">{row.changedBy}</td>
                    <td className="px-5 py-3 text-on-surface-variant">
                      <HistoryReason kind={row.kind} reason={row.reason} />
                    </td>
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
