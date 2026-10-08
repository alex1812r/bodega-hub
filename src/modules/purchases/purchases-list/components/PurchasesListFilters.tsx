"use client";

import { Search } from "lucide-react";

import { Button } from "@/shared/components/Button";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { PurchasesListFilterState } from "../utils/purchasesListState";

type PurchasesListFiltersProps = {
  hasActiveFilters: boolean;
  onChange: (patch: Partial<PurchasesListFilterState>) => void;
  onClear: () => void;
  state: PurchasesListFilterState;
};

export function PurchasesListFilters({
  hasActiveFilters,
  onChange,
  onClear,
  state,
}: PurchasesListFiltersProps) {
  const onlyPendingBalance = state.pendingBalance === "1";

  // Un rango invertido no se puede elegir: el otro extremo acompaña al que se mueve.
  function handleFromChange(from: string) {
    onChange(from && state.to && from > state.to ? { from, to: from } : { from });
  }

  function handleToChange(to: string) {
    onChange(to && state.from && to < state.from ? { from: to, to } : { to });
  }

  return (
    <section
      aria-label="Filtros de compras"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_9rem_9rem] md:gap-4">
        <div className="col-span-2 min-w-0 md:col-span-1">
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
              onChange={(event) => onChange({ search: event.target.value })}
              placeholder="N° factura o proveedor..."
              type="search"
              value={state.search}
            />
          </div>
        </div>

        <div className="col-span-2 min-w-0 md:col-span-1">
          <label className={stitchListFilterLabelClassName} htmlFor="purchases-status">
            Estado
          </label>
          <select
            className={stitchListFilterFieldClassName}
            id="purchases-status"
            onChange={(event) =>
              onChange({ status: event.target.value as PurchasesListFilterState["status"] })
            }
            value={state.status}
          >
            <option value="all">Todos los estados</option>
            <option value="pedido">Pedido</option>
            <option value="recibido">Recibido</option>
            <option value="cancelado">Cancelado</option>
            <option value="devuelto">Devuelto</option>
          </select>
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="purchases-from">
            Desde
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="purchases-from"
            max={state.to || undefined}
            onChange={(event) => handleFromChange(event.target.value)}
            type="date"
            value={state.from}
          />
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="purchases-to">
            Hasta
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="purchases-to"
            min={state.from || undefined}
            onChange={(event) => handleToChange(event.target.value)}
            type="date"
            value={state.to}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-pressed={onlyPendingBalance}
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            onlyPendingBalance
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-surface text-on-surface-variant hover:bg-surface-container",
          )}
          onClick={() => onChange({ pendingBalance: onlyPendingBalance ? "" : "1" })}
          type="button"
        >
          Con saldo pendiente
        </button>

        {hasActiveFilters ? (
          <Button onClick={onClear} size="sm" type="button" variant="outline">
            Limpiar filtros
          </Button>
        ) : null}

        <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
          Fechas en día operativo Caracas
        </p>
      </div>
    </section>
  );
}
