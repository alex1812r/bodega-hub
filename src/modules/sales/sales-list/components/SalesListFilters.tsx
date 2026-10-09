"use client";

import { Search } from "lucide-react";

import {
  DateRangeField,
  serializeDateRange,
  type DateRangeChange,
} from "@/shared/components/DateRangeField";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type { SalesListFilterState } from "../salesListParams";

type SalesListFiltersProps = {
  onChange: (patch: Partial<SalesListFilterState>) => void;
  /** Rango efectivo (`parseDateRangeParams` sobre el estado de la URL). */
  range: DateRangeChange;
  state: SalesListFilterState;
  /** Día operativo `YYYY-MM-DD`. */
  today: string;
};

export function SalesListFilters({ onChange, range, state, today }: SalesListFiltersProps) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800">
      <div className="flex flex-col gap-4 md:flex-row">
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
              onChange={(event) => onChange({ search: event.target.value })}
              placeholder="Buscar por N° factura o cliente..."
              type="search"
              value={state.search}
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
              onChange({ status: event.target.value as SalesListFilterState["status"] })
            }
            value={state.status}
          >
            <option value="all">Todos los estados</option>
            <option value="borrador">Borrador</option>
            <option value="pendiente_pago">Pendiente pago</option>
            <option value="pagada">Pagada</option>
            <option value="cancelada">Cancelada</option>
            <option value="devuelta">Devuelta</option>
          </select>
        </div>
      </div>

      <DateRangeField
        clearable
        label="Rango de fechas"
        maxDate={today}
        onChange={(next) => onChange(serializeDateRange(next))}
        size="sm"
        today={today}
        value={range}
      />
      <p className="text-xs text-muted-foreground">Fechas en día operativo Caracas</p>
    </section>
  );
}
