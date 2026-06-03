"use client";



import { type ReactNode } from "react";



import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";

import { EmptyState } from "@/shared/components/EmptyState";

import { ErrorState } from "@/shared/components/ErrorState";

import { TableSkeleton } from "@/shared/components/TableSkeleton";

import { useIsBelowMd } from "@/shared/hooks/useMediaQuery";

import { cn } from "@/shared/utils/cn";



import { DataTableCards } from "./DataTableCards";

import { getColumnVisibilityClass } from "./columnVisibility";



export type ColumnVisibility = "always" | "md" | "lg";



export type DataTableColumn<TData> = {

  align?: "left" | "right";

  className?: string;

  header: string;

  key: string;

  render: (row: TData) => ReactNode;

  visibility?: ColumnVisibility;

  hideInCard?: boolean;

};



export type DataTableLayout = "table" | "cards" | "auto";



type DataTableProps<TData> = {

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

  layout?: DataTableLayout;

  loadingRows?: number;

  onRetry?: () => void;

};



export function DataTable<TData>({

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

  layout = "auto",

  loadingRows = 5,

  onRetry,

}: DataTableProps<TData>) {

  const isBelowMd = useIsBelowMd();

  const useCards = layout === "cards" || (layout === "auto" && isBelowMd);



  if (useCards) {

    return (

      <DataTableCards

        actions={actions}

        cardSubtitle={cardSubtitle}

        cardTitle={cardTitle}

        columns={columns}

        data={data}

        emptyState={emptyState}

        error={error}

        getRowId={getRowId}

        isFetching={isFetching}

        isLoading={isLoading}

        loadingRows={loadingRows}

        onRetry={onRetry}

      />

    );

  }



  const colSpan = columns.length + (actions ? 1 : 0);

  const errorMessage = error instanceof Error ? error.message : error;



  return (

    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">

      {isFetching && data.length > 0 ? (

        <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-700 dark:border-blue-950 dark:bg-blue-950 dark:text-blue-300">

          Actualizando...

        </div>

      ) : null}

      <div className="overflow-x-auto">

        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">

          <thead className="bg-slate-50 dark:bg-slate-950">

            <tr>

              {columns.map((column) => (

                <th

                  className={cn(

                    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",

                    column.align === "right" && "text-right",

                    getColumnVisibilityClass(column.visibility),

                    column.className,

                  )}

                  key={column.key}

                  scope="col"

                >

                  {column.header}

                </th>

              ))}

              {actions ? (

                <th className="w-16 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">

                  Acciones

                </th>

              ) : null}

            </tr>

          </thead>

          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">

            {isLoading ? (

              <TableSkeleton

                columns={columns.length}

                rows={loadingRows}

                showActions={Boolean(actions)}

              />

            ) : error ? (

              <tr>

                <td colSpan={colSpan}>

                  <ErrorState

                    description={errorMessage ?? "Intenta nuevamente en unos segundos."}

                    onRetry={onRetry}

                    title="No pudimos cargar los datos"

                  />

                </td>

              </tr>

            ) : data.length > 0 ? (

              data.map((row) => (

                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800" key={getRowId(row)}>

                  {columns.map((column) => (

                    <td

                      className={cn(

                        "px-4 py-3 text-sm text-slate-700 dark:text-slate-300",

                        column.align === "right" && "text-right",

                        getColumnVisibilityClass(column.visibility),

                        column.className,

                      )}

                      key={column.key}

                    >

                      {column.render(row)}

                    </td>

                  ))}

                  {actions ? (

                    <td className="px-4 py-3 text-right">

                      <ActionsMenu actions={actions(row)} />

                    </td>

                  ) : null}

                </tr>

              ))

            ) : (

              <tr>

                <td

                  className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"

                  colSpan={colSpan}

                >

                  {emptyState ?? (

                    <EmptyState

                      description="Cuando existan datos, se mostraran en esta tabla."

                      title="No hay registros para mostrar"

                    />

                  )}

                </td>

              </tr>

            )}

          </tbody>

        </table>

      </div>

    </div>

  );

}

