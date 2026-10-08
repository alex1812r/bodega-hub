"use client";

import { AlertTriangle, Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import {
  PRODUCT_MARGIN_FILTER_OPTIONS,
  PRODUCT_SORT_CHOICES,
  PRODUCT_STATUS_FILTERS,
  productSortChoiceValue,
  type ProductsListFilterState,
} from "../productsListParams";

type ProductsListFiltersProps = {
  categoryOptions: Array<{ label: string; value: string }>;
  filters: ProductsListFilterState;
  onChange: (patch: Partial<ProductsListFilterState>) => void;
  /** Productos en "Por revisar" (`usePriceReviewSummary`); sin dato, el chip va sin contador. */
  reviewCount?: number;
};

const STATUS_LABELS: Record<ProductsListFilterState["status"], string> = {
  all: "Estado: Todos",
  active: "Activo",
  inactive: "Inactivo",
};

/** Baja / media / alta = bandas roja / amarilla / verde del semáforo; "Sin costo" queda fuera de las tres. */
const MARGIN_LABELS: Record<ProductsListFilterState["margin"], string> = {
  all: "Ganancia: Todas",
  low: "Baja",
  mid: "Media",
  high: "Alta",
  none: "Sin costo",
};

function isOneOf<TValue extends string>(
  options: readonly TValue[],
  value: string,
): value is TValue {
  return options.some((option) => option === value);
}

export function ProductsListFilters({
  categoryOptions,
  filters,
  onChange,
  reviewCount,
}: ProductsListFiltersProps) {
  const isReviewOn = filters.review === "1";

  return (
    <section className="w-full min-w-0 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5">
      <div className="grid w-full min-w-0 grid-cols-1 items-end gap-4 md:grid-cols-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="min-w-0 md:col-span-4 lg:col-span-1">
          <label className={stitchListFilterLabelClassName} htmlFor="products-search">
            Búsqueda
          </label>
          <div className="relative min-w-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 z-10 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className={cn(stitchListFilterFieldClassName, "w-full min-w-0 pl-10")}
              id="products-search"
              onChange={(event) => onChange({ search: event.target.value })}
              placeholder="Buscar por nombre, SKU o código de barras..."
              type="search"
              value={filters.search}
            />
          </div>
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="products-category">
            Categoría
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="products-category"
            onChange={(event) => onChange({ category: event.target.value })}
            value={filters.category}
          >
            <option value="">Todas las categorías</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="products-status">
            Estado
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="products-status"
            onChange={(event) => {
              const { value } = event.target;

              if (isOneOf(PRODUCT_STATUS_FILTERS, value)) {
                onChange({ status: value });
              }
            }}
            value={filters.status}
          >
            {PRODUCT_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="products-margin">
            Ganancia
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="products-margin"
            onChange={(event) => {
              const { value } = event.target;

              if (isOneOf(PRODUCT_MARGIN_FILTER_OPTIONS, value)) {
                onChange({ margin: value });
              }
            }}
            value={filters.margin}
          >
            {PRODUCT_MARGIN_FILTER_OPTIONS.map((margin) => (
              <option key={margin} value={margin}>
                {MARGIN_LABELS[margin]}
              </option>
            ))}
          </select>
        </div>

        {/* Desde lg ordenan las cabeceras de la tabla; por debajo (tarjetas, o tabla
            sin columna "Ganancia") el orden se elige aquí. Mismos `sort`/`dir` de la URL. */}
        <div className="min-w-0 lg:hidden">
          <label className={stitchListFilterLabelClassName} htmlFor="products-sort">
            Orden
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="products-sort"
            onChange={(event) => {
              const choice = PRODUCT_SORT_CHOICES.find(
                (option) => option.value === event.target.value,
              );

              if (choice) {
                onChange({ dir: choice.dir, sort: choice.sort });
              }
            }}
            value={productSortChoiceValue(filters)}
          >
            {PRODUCT_SORT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* "Por revisar" (PRO-11): se combina con los demás filtros y vive en `?review=1`. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          aria-pressed={isReviewOn}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isReviewOn
              ? "border-amber-600 bg-amber-600 text-white hover:bg-amber-700 dark:border-amber-500 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
              : "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low dark:hover:bg-surface-container",
          )}
          onClick={() => onChange({ review: isReviewOn ? "" : "1" })}
          title="Productos cuya ganancia bajó de banda al subir el costo"
          type="button"
        >
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          Por revisar
          {reviewCount === undefined ? null : (
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular-nums",
                isReviewOn
                  ? "bg-white/20"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
              )}
              data-testid="price-review-count"
            >
              {reviewCount}
            </span>
          )}
        </button>
      </div>
    </section>
  );
}
