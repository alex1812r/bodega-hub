"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode } from "react";

import type { SortOrder } from "@/lib/api/sorting";
import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { TableSkeleton } from "@/shared/components/TableSkeleton";
import { useIsBelowMd } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/utils/cn";

import { DataTableCards } from "./DataTableCards";
import { getColumnVisibilityClass } from "./columnVisibility";

export type ColumnVisibility = "always" | "md" | "lg";

export type DataTableVariant = "default" | "stitch" | "stitch-sales" | "stitch-purchases";

export type DataTableColumn<TData> = {
  align?: "center" | "left" | "right";
  /** Clases extra en celdas del cuerpo (p. ej. tipografía Stitch por columna). */
  cellClassName?: string;
  className?: string;
  header: string;
  headerClassName?: string;
  key: string;
  render: (row: TData) => ReactNode;
  sortable?: boolean;
  sortKey?: string;
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
  /** Omite el contenedor con borde cuando la tabla vive dentro de otra card. */
  embedded?: boolean;
  emptyState?: ReactNode;
  error?: Error | string | null;
  getRowId: (row: TData) => string;
  isFetching?: boolean;
  isLoading?: boolean;
  layout?: DataTableLayout;
  loadingRows?: number;
  onRetry?: () => void;
  onSortChange?: (columnKey: string) => void;
  sortBy?: string;
  sortOrder?: SortOrder;
  /** Tablas alineadas al design system Stitch (Inventario, etc.). */
  variant?: DataTableVariant;
};

const tableHeaderClassDefault =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const tableHeaderClassStitch =
  "px-4 py-3 text-left text-sm font-medium text-on-surface-variant";

const tableCellClassDefault = "px-4 py-3 text-sm text-foreground/90 dark:text-slate-300";

const tableCellClassStitch = "px-4 py-3 text-sm text-foreground";

function getColumnSortKey<TData>(column: DataTableColumn<TData>) {
  return column.sortKey ?? column.key;
}

function getAriaSortValue<TData>(
  column: DataTableColumn<TData>,
  sortBy?: string,
  sortOrder?: SortOrder,
): "ascending" | "descending" | "none" | undefined {
  if (!column.sortable) return undefined;

  const columnSortKey = getColumnSortKey(column);
  if (sortBy !== columnSortKey) return "none";
  return sortOrder === "desc" ? "descending" : "ascending";
}

function SortIcon<TData>({
  column,
  sortBy,
  sortOrder,
}: {
  column: DataTableColumn<TData>;
  sortBy?: string;
  sortOrder?: SortOrder;
}) {
  const columnSortKey = getColumnSortKey(column);
  const isActive = sortBy === columnSortKey;

  if (!isActive) {
    return <ArrowUpDown aria-hidden className="size-3.5 shrink-0 opacity-40" />;
  }

  if (sortOrder === "desc") {
    return <ArrowDown aria-hidden className="size-3.5 shrink-0" />;
  }

  return <ArrowUp aria-hidden className="size-3.5 shrink-0" />;
}

export function DataTable<TData>({
  actions,
  cardSubtitle,
  cardTitle,
  columns,
  data,
  embedded = false,
  emptyState,
  error,
  getRowId,
  isFetching = false,
  isLoading = false,
  layout = "auto",
  loadingRows = 5,
  onRetry,
  onSortChange,
  sortBy,
  sortOrder,
  variant = "default",
}: DataTableProps<TData>) {
  const isBelowMd = useIsBelowMd();
  const useCards = layout === "cards" || (layout === "auto" && isBelowMd);
  const isStitch =
    variant === "stitch" || variant === "stitch-sales" || variant === "stitch-purchases";
  const isStitchSales = variant === "stitch-sales";
  const isStitchPurchases = variant === "stitch-purchases";
  const tableHeaderClass =
    isStitchSales || isStitchPurchases
      ? "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
      : isStitch
        ? tableHeaderClassStitch
        : tableHeaderClassDefault;
  const tableCellClass = isStitch ? tableCellClassStitch : tableCellClassDefault;

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

  const tableContent = (
    <>
      {isFetching && data.length > 0 ? (
        <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:border-indigo-950 dark:bg-indigo-950 dark:text-indigo-300">
          Actualizando...
        </div>
      ) : null}
      <div className="w-full overflow-x-auto">
        <table
          className={cn(
            "w-full border-collapse text-left",
            isStitch && "min-w-[720px]",
            !isStitch && "divide-y divide-border dark:divide-slate-800",
          )}
        >
          <thead
            className={cn(
              isStitchSales
                ? "border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
                : isStitchPurchases
                  ? "border-b border-border bg-surface-container-low dark:border-slate-800"
                  : isStitch
                    ? "border-b border-border bg-surface-container dark:border-slate-800"
                    : "bg-surface-container-low dark:bg-slate-950",
            )}
          >
            <tr>
              {columns.map((column) => {
                const columnSortKey = getColumnSortKey(column);
                const ariaSort = getAriaSortValue(column, sortBy, sortOrder);
                const headerContent = column.sortable && onSortChange ? (
                  <button
                    className={cn(
                      "inline-flex items-center gap-1.5 transition-colors hover:text-foreground",
                      sortBy === columnSortKey && "text-foreground",
                    )}
                    onClick={() => onSortChange(columnSortKey)}
                    type="button"
                  >
                    <span>{column.header}</span>
                    <SortIcon column={column} sortBy={sortBy} sortOrder={sortOrder} />
                  </button>
                ) : (
                  column.header
                );

                return (
                <th
                  aria-sort={ariaSort}
                  className={cn(
                    tableHeaderClass,
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                    getColumnVisibilityClass(column.visibility),
                    column.className,
                    column.headerClassName,
                  )}
                  key={column.key}
                  scope="col"
                >
                  {headerContent}
                </th>
                );
              })}
              {actions ? (
                <th
                  className={cn(
                    tableHeaderClass,
                    isStitch ? "w-16 text-center" : "w-16 text-right",
                  )}
                >
                  Acciones
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody
            className={cn(
              "bg-surface-container-lowest dark:bg-slate-900",
              isStitchSales
                ? "divide-y divide-slate-100 text-sm dark:divide-slate-800"
                : isStitchPurchases
                  ? "divide-y divide-border/40 text-sm dark:divide-slate-800"
                  : isStitch
                    ? "divide-y divide-border text-sm dark:divide-slate-800"
                    : "divide-y divide-border dark:divide-slate-800",
            )}
          >
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
              data.map((row, index) => (
                <tr
                  className={cn(
                    "group transition-colors",
                    isStitchSales
                      ? "hover:bg-slate-50 dark:hover:bg-slate-800"
                      : isStitchPurchases
                        ? "hover:bg-surface-container-low/50 dark:hover:bg-slate-800"
                        : isStitch
                          ? "hover:bg-surface-container-low dark:hover:bg-slate-800"
                          : "hover:bg-surface-container-high dark:hover:bg-slate-800",
                    isStitchSales && index % 2 === 1 && "bg-slate-50/50 dark:bg-slate-800/40",
                    isStitchPurchases && index % 2 === 1 && "bg-surface-bright dark:bg-slate-800/20",
                    isStitch &&
                      !isStitchSales &&
                      !isStitchPurchases &&
                      index % 2 === 1 &&
                      "bg-surface-bright dark:bg-slate-800/40",
                    !isStitch && index % 2 === 1 && "bg-surface-container-low/70 dark:bg-slate-800/40",
                  )}
                  key={getRowId(row)}
                >
                  {columns.map((column) => (
                    <td
                      className={cn(
                        tableCellClass,
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                        getColumnVisibilityClass(column.visibility),
                        column.className,
                        column.cellClassName,
                      )}
                      key={column.key}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                  {actions ? (
                    <td
                      className={cn(
                        tableCellClass,
                        isStitch ? "text-center" : "text-right",
                      )}
                    >
                      <ActionsMenu actions={actions(row)} />
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
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
    </>
  );

  if (embedded) {
    return <div className="min-w-0 w-full">{tableContent}</div>;
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {tableContent}
    </div>
  );
}
