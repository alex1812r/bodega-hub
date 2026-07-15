"use client";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import type { StockMovementType } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import type { InventoryMovementFilters } from "../../hooks/useInventory";
import { movementTypeOptions } from "../utils/movementTypeLabels";

type ProductOption = {
  label: string;
  value: string;
};

type InventoryMovementsListFiltersProps = {
  filters: Pick<InventoryMovementFilters, "from" | "productId" | "to" | "type">;
  onChange: (patch: Partial<InventoryMovementFilters>) => void;
  productOptions: ProductOption[];
  productsError?: Error | null;
  productsLoading?: boolean;
};

export function InventoryMovementsListFilters({
  filters,
  onChange,
  productOptions,
  productsError,
  productsLoading,
}: InventoryMovementsListFiltersProps) {
  return (
    <section className="rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-product">
            Producto
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full")}
            disabled={productsLoading}
            id="movements-product"
            onChange={(event) =>
              onChange({ productId: event.target.value || undefined })
            }
            value={filters.productId ?? ""}
          >
            <option value="">Todos los productos</option>
            {productOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {productsError ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              No pudimos cargar los productos para filtrar.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-type">
            Tipo de movimiento
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="movements-type"
            onChange={(event) =>
              onChange({
                type: (event.target.value || undefined) as StockMovementType | undefined,
              })
            }
            value={filters.type ?? ""}
          >
            <option value="">Todos los tipos</option>
            {movementTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-from">
            Desde
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="movements-from"
            onChange={(event) => onChange({ from: event.target.value || undefined })}
            type="date"
            value={filters.from ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-to">
            Hasta
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="movements-to"
            onChange={(event) => onChange({ to: event.target.value || undefined })}
            type="date"
            value={filters.to ?? ""}
          />
        </div>
      </div>
    </section>
  );
}
