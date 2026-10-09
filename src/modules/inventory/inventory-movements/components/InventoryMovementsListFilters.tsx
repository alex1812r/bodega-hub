"use client";

import { Button } from "@/shared/components/Button";
import {
  DateRangeField,
  serializeDateRange,
  type DateRangeChange,
} from "@/shared/components/DateRangeField";
import {
  formHelperClassName,
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import {
  MOVEMENT_DOCUMENT_MIN_LENGTH,
  isMovementDocumentTooShort,
  type InventoryMovementsFilterState,
} from "../inventoryMovementsParams";
import { movementDocumentKindOptions } from "../utils/movementDocument";
import { movementTypeOptions } from "../utils/movementTypeLabels";
import { InventoryMovementsProductFilter } from "./InventoryMovementsProductFilter";

export const MOVEMENTS_RANGE_INVERTED_MESSAGE =
  "La fecha inicial no puede ser posterior a la final.";

const rangeErrorId = "movements-range-error";
const documentHelpId = "movements-document-help";

type InventoryMovementsListFiltersProps = {
  filters: InventoryMovementsFilterState;
  /** Hay algún filtro puesto: se ofrece "Limpiar filtros". */
  hasFilters: boolean;
  /** `from` posterior a `to`: se avisa junto a las fechas y no se consulta. */
  isRangeInverted: boolean;
  onChange: (patch: Partial<InventoryMovementsFilterState>) => void;
  onClear: () => void;
  /** Rango efectivo (`parseDateRangeParams` sobre el estado de la URL). */
  range: DateRangeChange;
  /** Día operativo `YYYY-MM-DD`. */
  today: string;
};

/**
 * Filtros de `/inventory/movements`. No guarda nada: pinta el estado de la URL
 * y cada cambio se aplica en el acto (el documento, con el debounce del hook).
 */
export function InventoryMovementsListFilters({
  filters,
  hasFilters,
  isRangeInverted,
  onChange,
  onClear,
  range,
  today,
}: InventoryMovementsListFiltersProps) {
  const isDocumentTooShort = isMovementDocumentTooShort(filters.document);
  // Filtro que llega en el enlace del detalle de una venta o una compra: no tiene campo.
  const pinnedDocumentLabel =
    filters.saleId && filters.purchaseId
      ? "una venta y una compra"
      : filters.saleId
        ? "una venta"
        : filters.purchaseId
          ? "una compra"
          : null;

  return (
    <section
      aria-label="Filtros"
      className="w-full min-w-0 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800 md:p-5"
    >
      {pinnedDocumentLabel ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-container-low px-3 py-2 dark:border-slate-800">
          <p className="min-w-0 text-sm text-foreground" role="status">
            Solo se muestran los movimientos de {pinnedDocumentLabel}.
          </p>
          <Button
            onClick={() => onChange({ purchaseId: "", saleId: "" })}
            size="sm"
            variant="ghost"
          >
            Ver todos los documentos
          </Button>
        </div>
      ) : null}

      <div className="grid w-full min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <InventoryMovementsProductFilter
            onChange={(productId) => onChange({ productId })}
            productId={filters.productId}
          />
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-type">
            Tipo de movimiento
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="movements-type"
            onChange={(event) =>
              onChange({
                type:
                  movementTypeOptions.find((option) => option.value === event.target.value)
                    ?.value ?? "",
              })
            }
            value={filters.type}
          >
            <option value="">Todos los tipos</option>
            {movementTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-document-kind">
            Tipo de documento
          </label>
          <select
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="movements-document-kind"
            onChange={(event) =>
              onChange({
                documentKind:
                  movementDocumentKindOptions.find((option) => option.value === event.target.value)
                    ?.value ?? "",
              })
            }
            value={filters.documentKind}
          >
            <option value="">Todos los documentos</option>
            {movementDocumentKindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label className={stitchListFilterLabelClassName} htmlFor="movements-document">
            Número de documento
          </label>
          <input
            aria-describedby={isDocumentTooShort ? documentHelpId : undefined}
            className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
            id="movements-document"
            maxLength={100}
            onChange={(event) => onChange({ document: event.target.value })}
            placeholder="Venta o compra, p. ej. V-0001"
            type="search"
            value={filters.document}
          />
          {isDocumentTooShort ? (
            <p className={cn(formHelperClassName, "mt-1")} id={documentHelpId}>
              Escribe al menos {MOVEMENT_DOCUMENT_MIN_LENGTH} caracteres
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <DateRangeField
          clearable
          label="Rango de fechas"
          maxDate={today}
          onChange={(next) => onChange(serializeDateRange(next))}
          size="sm"
          today={today}
          value={range}
        />
      </div>

      {isRangeInverted || hasFilters ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isRangeInverted ? (
            <p className="min-w-0 text-sm text-error" id={rangeErrorId} role="alert">
              {MOVEMENTS_RANGE_INVERTED_MESSAGE} Elige otro rango para ver los movimientos.
            </p>
          ) : null}
          {hasFilters ? (
            <Button className="ml-auto" onClick={onClear} size="sm" variant="ghost">
              Limpiar filtros
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
