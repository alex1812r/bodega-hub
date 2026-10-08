"use client";

import { Search } from "lucide-react";

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
}: ProductsListFiltersProps) {
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
    </section>
  );
}
