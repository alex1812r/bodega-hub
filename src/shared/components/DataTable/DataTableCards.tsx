"use client";

import { type ReactNode } from "react";

import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { Skeleton } from "@/shared/components/Skeleton";

import { type DataTableColumn } from "./DataTable";

type DataTableCardsProps<TData> = {
  actions?: (row: TData) => ActionMenuItem[];
  cardSubtitle?: (row: TData) => ReactNode;
  cardTitle?: (row: TData) => ReactNode;
  columns: DataTableColumn<TData>[];
  data: TData[];
  emptyState?: ReactNode;
  error?: Error | string | null;
  getRowId: (row: TData) => string;
  isFetching?: boolean;
  isLoading?: boolean;
  loadingRows?: number;
  onRetry?: () => void;
};

export function DataTableCards<TData>({
  actions,
  cardSubtitle,
  cardTitle,
  columns,
  data,
  emptyState,
  error,
  getRowId,
  isFetching = false,
  isLoading = false,
  loadingRows = 5,
  onRetry,
}: DataTableCardsProps<TData>) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {isFetching && data.length > 0 ? (
        <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-950 dark:bg-indigo-950 dark:text-indigo-300">
          Actualizando...
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: loadingRows }).map((_, index) => (
            <div
              className="space-y-2 rounded-xl border border-slate-100 p-4 dark:border-slate-800"
              key={index}
            >
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorState
            description={errorMessage ?? "Intenta nuevamente en unos segundos."}
            onRetry={onRetry}
            title="No pudimos cargar los datos"
          />
        </div>
      ) : data.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.map((row) => {
            const rowActions = actions?.(row);

            return (
              <li className="p-4" key={getRowId(row)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {cardTitle ? (
                      <p className="font-semibold text-slate-950 dark:text-slate-100">
                        {cardTitle(row)}
                      </p>
                    ) : null}
                    {cardSubtitle ? (
                      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                        {cardSubtitle(row)}
                      </p>
                    ) : null}
                  </div>
                  {rowActions?.length ? (
                    <ActionsMenu actions={rowActions} />
                  ) : null}
                </div>
                <dl className="mt-3 grid gap-2">
                  {columns.filter((column) => !column.hideInCard).map((column) => (
                    <div
                      className="flex items-start justify-between gap-3 text-sm"
                      key={column.key}
                    >
                      <dt className="shrink-0 text-slate-500 dark:text-slate-400">
                        {column.header}
                      </dt>
                      <dd
                        className={
                          column.align === "right"
                            ? "text-right font-medium text-slate-950 dark:text-slate-100"
                            : "min-w-0 text-right font-medium text-slate-950 dark:text-slate-100"
                        }
                      >
                        {column.render(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {emptyState ?? (
            <EmptyState
              description="Cuando existan datos, se mostraran aqui."
              title="No hay registros para mostrar"
            />
          )}
        </div>
      )}
    </div>
  );
}
