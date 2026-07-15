"use client";

import { Filter } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import type { CategoryMock } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import {
  inventoryStockStatusLabels,
  type InventoryStockStatus,
} from "../../utils/inventoryStockStatus";

export type InventorySidebarFilters = {
  categoryId?: string;
  search?: string;
  stockStatus: Record<InventoryStockStatus, boolean>;
};

export const defaultInventorySidebarFilters: InventorySidebarFilters = {
  stockStatus: {
    low: true,
    ok: true,
    out: true,
  },
};

type InventoryFiltersSidebarProps = {
  categories: CategoryMock[];
  className?: string;
  filters: InventorySidebarFilters;
  onApply: () => void;
  onChange: (filters: InventorySidebarFilters) => void;
  onClear: () => void;
};

export function InventoryFiltersSidebar({
  categories,
  className,
  filters,
  onApply,
  onChange,
  onClear,
}: InventoryFiltersSidebarProps) {
  function updateStockStatus(status: InventoryStockStatus, checked: boolean) {
    onChange({
      ...filters,
      stockStatus: {
        ...filters.stockStatus,
        [status]: checked,
      },
    });
  }

  return (
    <div
      className={cn(
        "sticky top-20 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Filter aria-hidden className="size-5 text-primary" />
          Filtros
        </h3>
        <button
          className="text-xs font-semibold tracking-wide text-primary hover:underline"
          onClick={onClear}
          type="button"
        >
          Limpiar
        </button>
      </div>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <Input
          label="Producto o SKU"
          onChange={(event) =>
            onChange({
              ...filters,
              search: event.target.value || undefined,
            })
          }
          placeholder="Buscar en bodega"
          value={filters.search ?? ""}
        />

        <SelectField
          label="Categoria"
          onChange={(event) =>
            onChange({
              ...filters,
              categoryId: event.target.value || undefined,
            })
          }
          options={categories.map((category) => ({
            label: category.name,
            value: category.id,
          }))}
          placeholder="Todas las categorias"
          value={filters.categoryId ?? ""}
        />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Estado de stock</legend>
          <div className="flex flex-col gap-2">
            {(Object.keys(inventoryStockStatusLabels) as InventoryStockStatus[]).map(
              (status) => (
                <label
                  className="group flex cursor-pointer items-center gap-3"
                  key={status}
                >
                  <input
                    checked={filters.stockStatus[status]}
                    className="size-4 rounded border-border bg-surface-bright text-primary focus:ring-primary focus:ring-offset-0"
                    onChange={(event) => updateStockStatus(status, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="text-sm text-on-surface-variant group-hover:text-foreground">
                    {inventoryStockStatusLabels[status]}
                  </span>
                </label>
              ),
            )}
          </div>
        </fieldset>

        <Button
          className="mt-2 w-full border-border bg-surface-container text-foreground shadow-sm hover:bg-surface-container-high"
          type="submit"
          variant="secondary"
        >
          Aplicar filtros
        </Button>
      </form>
    </div>
  );
}
