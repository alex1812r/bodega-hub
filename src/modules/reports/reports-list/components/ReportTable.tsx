"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { getPaginatedItems, type PaginatedList } from "@/lib/api/pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { ResponsivePagination } from "@/shared/components/Pagination";

import type { ReportDefinition } from "../config/reportCatalog";

/** Página y tamaño de la tabla del reporte (misma forma que `usePaginationState`). */
export type ReportPagination = {
  limit: number;
  setLimit: (limit: number) => void;
  setSkip: (skip: number) => void;
  skip: number;
};

export function formatResultsRange(skip: number, limit: number, total: number) {
  if (total === 0) {
    return "Sin registros";
  }

  const start = skip + 1;
  const end = Math.min(skip + limit, total);
  return `Mostrando ${start}-${end} de ${total} registros`;
}

type PagedQuery<TData> = Pick<
  UseQueryResult<PaginatedList<TData>, Error>,
  "data" | "error" | "isFetching" | "isLoading" | "refetch"
>;

/**
 * La página pedida ya no existe (el total bajó, o la URL trae una página de
 * más): vuelve a la primera en vez de mostrar «No hay registros» con datos
 * disponibles.
 */
export function useResetPagePastTheEnd<TData>(
  query: Pick<PagedQuery<TData>, "data" | "isFetching">,
  pagination: Pick<ReportPagination, "setSkip" | "skip">,
) {
  const { data, isFetching } = query;
  const { setSkip, skip } = pagination;
  const isPagePastTheEnd =
    !isFetching && data !== undefined && data.items.length === 0 && data.total > 0 && skip > 0;

  useEffect(() => {
    if (isPagePastTheEnd) {
      setSkip(0);
    }
  }, [isPagePastTheEnd, setSkip]);
}

type ReportTableProps<TData> = {
  /** Acciones de la cabecera del reporte, junto al resumen de resultados. */
  actions?: ReactNode;
  columns: DataTableColumn<TData>[];
  /** Estado vacío propio; por defecto, el de `DataTable`. */
  emptyState?: ReactNode;
  getRowId: (row: TData) => string;
  limit: number;
  onLimitChange: (limit: number) => void;
  onSkipChange: (skip: number) => void;
  query: PagedQuery<TData>;
  report: Pick<ReportDefinition, "name">;
  skip: number;
};

/** Tabla paginada en servidor de un reporte: cabecera, filas y paginación. */
export function ReportTable<TData>({
  actions,
  columns,
  emptyState,
  getRowId,
  limit,
  onLimitChange,
  onSkipChange,
  query,
  report,
  skip,
}: ReportTableProps<TData>) {
  const total = query.data?.total ?? 0;
  const currentSkip = query.data?.skip ?? skip;

  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-col gap-2 border-b border-outline-variant bg-surface-container-low px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-on-surface">Resultados: {report.name}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-on-surface-variant">
            {formatResultsRange(currentSkip, limit, total)}
          </span>
          {actions}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={getPaginatedItems(query.data)}
        embedded
        emptyState={emptyState}
        error={query.error}
        getRowId={getRowId}
        isFetching={query.isFetching}
        isLoading={query.isLoading}
        layout="table"
        loadingRows={5}
        onRetry={() => void query.refetch()}
        variant="stitch"
      />

      <div className="flex justify-center border-t border-outline-variant px-4 py-3">
        <ResponsivePagination
          className="w-full justify-end"
          isDisabled={query.isFetching}
          limit={limit}
          onLimitChange={onLimitChange}
          onSkipChange={onSkipChange}
          showSummary={false}
          skip={currentSkip}
          total={total}
          variant="stitch"
        />
      </div>
    </section>
  );
}
