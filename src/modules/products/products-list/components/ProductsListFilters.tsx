"use client";

import { Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { ProductsFilters } from "../../hooks/useProducts";

type ProductsListFiltersProps = {
  filters: Pick<ProductsFilters, "categoryId" | "isActive" | "search">;
  onChange: (patch: Partial<ProductsFilters>) => void;
  categoryOptions: Array<{ label: string; value: string }>;
};

function isActiveFilterValue(isActive: ProductsFilters["isActive"]) {
  if (isActive === true || isActive === "true") {
    return "true";
  }

  if (isActive === false || isActive === "false") {
    return "false";
  }

  return "";
}

export function ProductsListFilters({
  categoryOptions,
  filters,
  onChange,
}: ProductsListFiltersProps) {
  return (
    <section className="w-full min-w-0 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5">
      <div className="products-list-filters-grid">
        <div className="min-w-0">
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
              onChange={(event) =>
                onChange({ search: event.target.value.trim() || undefined })
              }
              placeholder="Buscar por nombre, SKU o codigo de barras..."
              type="search"
              value={filters.search ?? ""}
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
            onChange={(event) =>
              onChange({ categoryId: event.target.value || undefined })
            }
            value={filters.categoryId ?? ""}
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
              const value = event.target.value;
              onChange({
                isActive:
                  value === "true" ? true : value === "false" ? false : undefined,
              });
            }}
            value={isActiveFilterValue(filters.isActive)}
          >
            <option value="">Estado: Todos</option>
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </div>
      </div>
    </section>
  );
}
