"use client";

import { Search } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { NumberInput } from "@/shared/components/NumberInput";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import { inventoryStockStatusLabels } from "../../utils/inventoryStockStatus";
import {
  INVENTORY_MAX_PRICE_FILTER,
  INVENTORY_STOCK_STATUS_FILTERS,
  type InventoryListFilterState,
} from "../inventoryListParams";

type InventoryListFiltersProps = {
  categoryOptions: Array<{ label: string; value: string }>;
  filters: InventoryListFilterState;
  /** Hay algún filtro puesto: se ofrece "Limpiar filtros". */
  hasFilters: boolean;
  onChange: (patch: Partial<InventoryListFilterState>) => void;
  onClear: () => void;
};

const chipClassName =
  "inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const chipOnClassName = "border-primary bg-primary text-primary-foreground";
const chipOffClassName =
  "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low dark:hover:bg-surface-container";

/**
 * Filtros de `/inventory`. No guarda nada: pinta el estado de la URL y cada
 * cambio se aplica en el acto (los campos tecleados, con el debounce del hook).
 */
export function InventoryListFilters({
  categoryOptions,
  filters,
  hasFilters,
  onChange,
  onClear,
}: InventoryListFiltersProps) {
  function toggleStatus(status: (typeof INVENTORY_STOCK_STATUS_FILTERS)[number]) {
    onChange({
      status: filters.status.includes(status)
        ? filters.status.filter((current) => current !== status)
        : INVENTORY_STOCK_STATUS_FILTERS.filter(
            (current) => current === status || filters.status.includes(current),
          ),
    });
  }

  return (
    <section
      aria-label="Filtros"
      className="w-full min-w-0 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5"
    >
      <div className="grid w-full min-w-0 grid-cols-2 items-end gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.25fr)_repeat(2,minmax(0,0.75fr))]">
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <label className={stitchListFilterLabelClassName} htmlFor="inventory-search">
            Búsqueda
          </label>
          <div className="relative min-w-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 z-10 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className={cn(stitchListFilterFieldClassName, "w-full min-w-0 pl-10")}
              id="inventory-search"
              onChange={(event) => onChange({ search: event.target.value })}
              placeholder="Buscar por nombre, SKU o código de barras..."
              type="search"
              value={filters.search}
            />
          </div>
        </div>

        <div className="col-span-2 min-w-0 lg:col-span-1">
          <label className={stitchListFilterLabelClassName} htmlFor="inventory-category">
            Categoría
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="inventory-category"
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
          <label className={stitchListFilterLabelClassName} htmlFor="inventory-min-price">
            Precio mínimo (REF)
          </label>
          <NumberInput
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            decimals={2}
            id="inventory-min-price"
            max={INVENTORY_MAX_PRICE_FILTER}
            onValueChange={(value) => onChange({ minPrice: value })}
            placeholder="Desde"
            value={filters.minPrice}
          />
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="inventory-max-price">
            Precio máximo (REF)
          </label>
          <NumberInput
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            decimals={2}
            id="inventory-max-price"
            max={INVENTORY_MAX_PRICE_FILTER}
            onValueChange={(value) => onChange({ maxPrice: value })}
            placeholder="Hasta"
            value={filters.maxPrice}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div
          aria-label="Estado de stock"
          className="flex flex-wrap items-center gap-2"
          role="group"
          title="Sin ninguno marcado se muestran todos los estados"
        >
          {INVENTORY_STOCK_STATUS_FILTERS.map((status) => {
            const isOn = filters.status.includes(status);

            return (
              <button
                aria-pressed={isOn}
                className={cn(chipClassName, isOn ? chipOnClassName : chipOffClassName)}
                key={status}
                onClick={() => toggleStatus(status)}
                type="button"
              >
                {inventoryStockStatusLabels[status]}
              </button>
            );
          })}
        </div>

        <button
          aria-pressed={filters.lowStock}
          className={cn(chipClassName, filters.lowStock ? chipOnClassName : chipOffClassName)}
          onClick={() => onChange({ lowStock: !filters.lowStock })}
          title="Productos con stock bajo o agotado"
          type="button"
        >
          Solo por reponer
        </button>

        {hasFilters ? (
          <Button className="ml-auto" onClick={onClear} size="sm" variant="ghost">
            Limpiar filtros
          </Button>
        ) : null}
      </div>
    </section>
  );
}
