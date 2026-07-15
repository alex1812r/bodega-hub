"use client";

import { Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { SalesFilters } from "../../hooks/useSales";

type SalesListFiltersProps = {
  filters: SalesFilters;
  onChange: (patch: Partial<SalesFilters>) => void;
};

export function SalesListFilters({ filters, onChange }: SalesListFiltersProps) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 md:flex-row">
      <div className="min-w-0 flex-1">
        <label className={stitchListFilterLabelClassName} htmlFor="sales-search">
          Búsqueda
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className={cn(stitchListFilterFieldClassName, "pl-10")}
            id="sales-search"
            onChange={(event) =>
              onChange({ search: event.target.value.trim() || undefined })
            }
            placeholder="Buscar por N° factura o cliente..."
            type="search"
            value={filters.search ?? ""}
          />
        </div>
      </div>

      <div className="w-full md:w-48">
        <label className={stitchListFilterLabelClassName} htmlFor="sales-status">
          Estado
        </label>
        <select
          className={stitchListFilterFieldClassName}
          id="sales-status"
          onChange={(event) =>
            onChange({ status: event.target.value || undefined })
          }
          value={filters.status ?? ""}
        >
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="pendiente_pago">Pendiente pago</option>
          <option value="pagada">Pagada</option>
          <option value="cancelada">Cancelada</option>
          <option value="devuelta">Devuelta</option>
        </select>
      </div>

      <div className="flex w-full gap-2 md:w-auto">
        <div className="w-1/2 md:w-36">
          <label className={stitchListFilterLabelClassName} htmlFor="sales-from">
            Desde
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="sales-from"
            onChange={(event) =>
              onChange({ from: event.target.value || undefined })
            }
            type="date"
            value={filters.from ?? ""}
          />
        </div>
        <div className="w-1/2 md:w-36">
          <label className={stitchListFilterLabelClassName} htmlFor="sales-to">
            Hasta
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="sales-to"
            onChange={(event) =>
              onChange({ to: event.target.value || undefined })
            }
            type="date"
            value={filters.to ?? ""}
          />
        </div>
      </div>
    </section>
  );
}
