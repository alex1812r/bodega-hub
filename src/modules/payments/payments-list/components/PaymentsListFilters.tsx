"use client";

import { X } from "lucide-react";

import { Button } from "@/shared/components/Button";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";

import { paymentMethodLabels } from "../../payment-details/utils/paymentDetailLabels";
import type { PaymentsFilterChip, PaymentsFilterChipKey } from "../hooks/usePaymentsFilterChips";
import { PAYMENT_METHOD_FILTER_VALUES, type PaymentsListState } from "../utils/paymentsListState";

type PaymentsListFiltersProps = {
  /** Filtros de enlace profundo activos (venta, compra, contacto). */
  chips: PaymentsFilterChip[];
  hasActiveFilters: boolean;
  onChange: (patch: Partial<PaymentsListState>) => void;
  onClear: () => void;
  onRemoveChip: (key: PaymentsFilterChipKey) => void;
  /** Vendedor: solo cobros de venta, el tipo queda fijo en "Entrada". */
  salePaymentsOnly?: boolean;
  state: Pick<PaymentsListState, "direction" | "from" | "method" | "to">;
};

export function PaymentsListFilters({
  chips,
  hasActiveFilters,
  onChange,
  onClear,
  onRemoveChip,
  salePaymentsOnly = false,
  state,
}: PaymentsListFiltersProps) {
  // Un rango invertido no se puede elegir: el otro extremo acompaña al que se mueve.
  function handleFromChange(from: string) {
    onChange(from && state.to && from > state.to ? { from, to: from } : { from });
  }

  function handleToChange(to: string) {
    onChange(to && state.from && to < state.from ? { from: to, to } : { to });
  }

  return (
    <section
      aria-label="Filtros de pagos"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-from">
            Desde
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="payments-from"
            max={state.to || undefined}
            onChange={(event) => handleFromChange(event.target.value)}
            type="date"
            value={state.from}
          />
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-to">
            Hasta
          </label>
          <input
            className={stitchListFilterFieldClassName}
            id="payments-to"
            min={state.from || undefined}
            onChange={(event) => handleToChange(event.target.value)}
            type="date"
            value={state.to}
          />
        </div>

        <div className="col-span-2 min-w-0 md:col-span-1">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-method">
            Método
          </label>
          <select
            className={stitchListFilterFieldClassName}
            id="payments-method"
            onChange={(event) =>
              onChange({ method: event.target.value as PaymentsListState["method"] })
            }
            value={state.method}
          >
            <option value="all">Todos los métodos</option>
            {PAYMENT_METHOD_FILTER_VALUES.map((method) => (
              <option key={method} value={method}>
                {paymentMethodLabels[method]}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2 min-w-0 md:col-span-1">
          <label className={stitchListFilterLabelClassName} htmlFor="payments-type">
            Tipo
          </label>
          <select
            className={stitchListFilterFieldClassName}
            id="payments-type"
            onChange={(event) =>
              onChange({ direction: event.target.value as PaymentsListState["direction"] })
            }
            value={salePaymentsOnly ? "entrada" : state.direction}
          >
            {salePaymentsOnly ? null : <option value="all">Todos los tipos</option>}
            <option value="entrada">Entrada</option>
            {salePaymentsOnly ? null : <option value="salida">Salida</option>}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <span
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            key={chip.key}
          >
            <span className="min-w-0 truncate">{chip.label}</span>
            <button
              aria-label={`Quitar filtro ${chip.label}`}
              className="shrink-0 cursor-pointer rounded-full p-1 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-indigo-900"
              onClick={() => onRemoveChip(chip.key)}
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}

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
