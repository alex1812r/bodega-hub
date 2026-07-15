"use client";

import { Search } from "lucide-react";

import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { PurchasesFilters } from "../../hooks/usePurchases";

type PurchasesListFiltersProps = {
  filters: PurchasesFilters;
  onChange: (patch: Partial<PurchasesFilters>) => void;
};

export function PurchasesListFilters({ filters, onChange }: PurchasesListFiltersProps) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800 md:flex-row">
      <div className="min-w-0 flex-1">
        <label className={stitchListFilterLabelClassName} htmlFor="purchases-search">
          Búsqueda
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className={cn(stitchListFilterFieldClassName, "pl-10")}
            id="purchases-search"
            onChange={(event) =>
              onChange({ search: event.target.value.trim() || undefined })
            }
            placeholder="N° factura o proveedor..."
            type="search"
            value={filters.search ?? ""}
          />
        </div>
      </div>

      <div className="w-full md:w-48">
        <label className={stitchListFilterLabelClassName} htmlFor="purchases-status">
          Estado
        </label>
        <select
          className={stitchListFilterFieldClassName}
          id="purchases-status"
          onChange={(event) =>
            onChange({ status: event.target.value || undefined })
          }
          value={filters.status ?? ""}
        >
          <option value="">Todos los estados</option>
          <option value="pedido">Pedido</option>
          <option value="recibido">Recibido</option>
          <option value="cancelado">Cancelado</option>
          <option value="devuelto">Devuelto</option>
        </select>
      </div>

      <div className="flex w-full gap-2 md:w-auto">
        <div className="w-1/2 md:w-36">
          <label className={stitchListFilterLabelClassName} htmlFor="purchases-from">
            Desde
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="purchases-from"
            onChange={(event) =>
              onChange({ from: event.target.value || undefined })
            }
            type="date"
            value={filters.from ?? ""}
          />
        </div>
        <div className="w-1/2 md:w-36">
          <label className={stitchListFilterLabelClassName} htmlFor="purchases-to">
            Hasta
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="purchases-to"
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
