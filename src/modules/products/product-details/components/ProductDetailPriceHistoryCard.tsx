"use client";

import { getPriceChangeReason } from "@/lib/api/dataSourceUi";
import { DEFAULT_PAGE_LIMIT, getPaginatedItems } from "@/lib/api/pagination";
import { ErrorState } from "@/shared/components/ErrorState";
import { ResponsivePagination } from "@/shared/components/Pagination";
import { useReportReady } from "@/shared/hooks/useReportReady";
import { formatDate } from "@/shared/utils/date";

import type { ProductPriceHistoryEntry } from "../../hooks/useProducts";
import { useProductPriceHistoryPage } from "../hooks/useProductPriceHistoryPage";
import {
  ProductDetailPriceHistoryTable,
  type ProductPriceHistoryRow,
} from "./ProductDetailPriceHistoryTable";

function mapPriceHistory(rows: ProductPriceHistoryEntry[]): ProductPriceHistoryRow[] {
  return rows.map((row, index) => ({
    // Nunca el id: sin nombre (línea base, o un perfil que no puedes ver) queda "—".
    changedBy: row.userName?.trim() || "—",
    date: formatDate(row.createdAt),
    id: row.id,
    // Entradas anteriores a PRO-11 no traen `kind`: eran todas cambios de precio.
    kind: row.kind ?? "change",
    newPriceRef: row.salePriceRef,
    // El precio anterior es el que guardó la propia fila. Solo si no lo trae se
    // deduce de la fila vecina de la misma página; la más antigua sin dato queda
    // sin precio anterior (antes repetía el suyo: "14.00 → 14.00").
    oldPriceRef: row.previousSalePriceRef ?? rows[index + 1]?.salePriceRef ?? null,
    // El motivo guardado; el texto fijo solo si el cambio se registró sin motivo.
    reason: row.reason?.trim() || getPriceChangeReason(),
  }));
}

type ProductDetailPriceHistoryCardProps = {
  /** Aviso de que el historial ya cargó (con filas, vacío o con error). */
  onReady?: () => void;
  productId: string;
};

/** Historial de precios del producto, paginado en servidor y con la página en la URL. */
export function ProductDetailPriceHistoryCard({
  onReady,
  productId,
}: ProductDetailPriceHistoryCardProps) {
  const history = useProductPriceHistoryPage(productId);
  const total = history.data?.total ?? 0;

  useReportReady(!history.isLoading, onReady);

  if (history.error) {
    return (
      <ErrorState
        description={
          history.error instanceof Error
            ? history.error.message
            : "No pudimos cargar el historial de precios."
        }
        onRetry={() => void history.refetch()}
        title="No pudimos cargar el historial de precios"
      />
    );
  }

  return (
    <ProductDetailPriceHistoryTable
      footer={
        total > DEFAULT_PAGE_LIMIT ? (
          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="cambios"
              isDisabled={history.isFetching}
              limit={history.limit}
              onLimitChange={history.setLimit}
              onSkipChange={history.setSkip}
              skip={history.data?.skip ?? history.skip}
              total={total}
              variant="stitch"
            />
          </div>
        ) : null
      }
      highlightFirst={(history.data?.skip ?? history.skip) === 0}
      isLoading={history.isLoading}
      rows={mapPriceHistory(getPaginatedItems(history.data))}
    />
  );
}
