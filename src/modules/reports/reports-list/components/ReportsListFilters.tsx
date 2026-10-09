"use client";

import { Filter } from "lucide-react";
import { useId, useState } from "react";

import { InventoryMovementsProductFilter } from "@/modules/inventory/inventory-movements/components/InventoryMovementsProductFilter";
import {
  fetchPurchaseSupplierOptions,
  usePurchaseSupplier,
} from "@/modules/purchases/hooks/usePurchaseSuppliers";
import {
  DateRangeField,
  type DateRangeChange,
  type DateRangePreset,
} from "@/shared/components/DateRangeField";
import {
  EntityAutocomplete,
  type EntityAutocompleteValue,
} from "@/shared/components/EntityAutocomplete";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type {
  PurchasesReportFilters,
  ReportDateRangeFilters,
  StockCardReportFilters,
} from "../../hooks/useReports";
import type { ReportGroupBy } from "../../services/reportSeries";
import type { ReportDefinition } from "../config/reportCatalog";

const GROUP_BY_OPTIONS: readonly { label: string; value: ReportGroupBy | undefined }[] = [
  { label: "Automático", value: undefined },
  { label: "Día", value: "day" },
  { label: "Semana", value: "week" },
  { label: "Mes", value: "month" },
];

type ReportsListFiltersProps = {
  /** `from` / `to` del rango y, en los reportes de serie, `groupBy` y `compare`. */
  dateFilters: ReportDateRangeFilters;
  /** Preset activo del rango, para marcar su chip aunque las fechas coincidan con otro. */
  datePreset?: DateRangePreset;
  /** Rango (`{ from, to }` en un solo patch), `groupBy` o `compare`. */
  onDateChange: (patch: Partial<ReportDateRangeFilters>) => void;
  /**
   * Rango elegido con su preset. Si se pasa, el rango se avisa SOLO por aquí
   * (para guardarlo con `serializeDateRange`) y no por `onDateChange` /
   * `onPurchasesChange`.
   */
  onDateRangeChange?: (next: DateRangeChange) => void;
  onPurchasesChange: (patch: Partial<PurchasesReportFilters>) => void;
  onStockCardChange: (patch: Partial<StockCardReportFilters>) => void;
  purchasesFilters: PurchasesReportFilters;
  /**
   * Reporte activo: la barra muestra solo los controles que ese reporte usa y
   * busca proveedor y producto en la tienda activa. Sin él (reportes de
   * plataforma, varias tiendas) se muestran rango, proveedor y producto, estos
   * dos como texto con el id.
   */
  report?: ReportDefinition;
  stockCardFilters: StockCardReportFilters;
  /** Día operativo `YYYY-MM-DD`; por defecto, hoy en Caracas. */
  today?: string;
};

function SupplierFilter({
  onChange,
  supplierId,
}: {
  onChange: (supplierId: string | undefined) => void;
  supplierId: string | undefined;
}) {
  const [picked, setPicked] = useState<EntityAutocompleteValue | null>(null);
  const pickedLabel = picked && picked.id === supplierId ? picked.label : undefined;
  // Lo elegido en el buscador ya trae su nombre: solo se lee el que vino en la URL.
  const supplierQuery = usePurchaseSupplier(pickedLabel === undefined ? supplierId : undefined);
  const label =
    pickedLabel ??
    supplierQuery.data?.name ??
    (supplierQuery.error ? "Proveedor no disponible" : "Cargando proveedor…");

  return (
    <EntityAutocomplete
      entity="contact"
      error={pickedLabel === undefined ? supplierQuery.error?.message : undefined}
      fetcher={fetchPurchaseSupplierOptions}
      label="Proveedor"
      onChange={(option) => {
        setPicked(option ? { id: option.id, label: option.label } : null);
        onChange(option?.id);
      }}
      placeholder="Todos los proveedores"
      // La búsqueda de compras solo trae activos: un reciente guardado puede no serlo.
      recentsKey={null}
      renderSecondary={(option) => option.taxId}
      value={supplierId ? { id: supplierId, label } : null}
    />
  );
}

function TextIdFilter({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string | undefined) => void;
  value: string | undefined;
}) {
  const inputId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label className={stitchListFilterLabelClassName} htmlFor={inputId}>
        {label}
      </label>
      <input
        className={cn(stitchListFilterFieldClassName, "w-full")}
        id={inputId}
        onChange={(event) => onChange(event.target.value.trim() || undefined)}
        type="text"
        value={value ?? ""}
      />
    </div>
  );
}

export function ReportsListFilters({
  dateFilters,
  datePreset,
  onDateChange,
  onDateRangeChange,
  onPurchasesChange,
  onStockCardChange,
  purchasesFilters,
  report,
  stockCardFilters,
  today,
}: ReportsListFiltersProps) {
  const compareId = useId();
  const usesDateRange = report?.usesDateRange ?? true;
  const showGroupBy = report?.supportsGroupBy ?? false;
  const showCompare = report?.supportsCompare ?? false;
  const showSupplier = !report || report.entityFilter === "supplier";
  const showProduct = !report || report.entityFilter === "product";
  const hasFullRange = Boolean(dateFilters.from && dateFilters.to);

  function handleRangeChange(next: DateRangeChange) {
    if (onDateRangeChange) {
      onDateRangeChange(next);
      return;
    }

    const range = { from: next.from, to: next.to };

    onDateChange(range);
    onPurchasesChange(range);
  }

  return (
    <section
      aria-label="Filtros del reporte"
      className="space-y-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-on-surface">
        <Filter aria-hidden className="size-5 shrink-0" />
        <h3 className="text-sm font-medium text-foreground">Filtros</h3>
        <p className="text-xs text-on-surface-variant">Día operativo Caracas (America/Caracas)</p>
      </div>

      <div className="space-y-1.5">
        <DateRangeField
          clearable
          disabled={!usesDateRange}
          label="Rango de fechas"
          maxDate={today}
          onChange={handleRangeChange}
          size="sm"
          today={today}
          value={{ from: dateFilters.from, preset: datePreset, to: dateFilters.to }}
        />
        {usesDateRange ? null : (
          <p className="text-xs text-on-surface-variant" role="note">
            Este reporte no usa rango de fechas.
          </p>
        )}
      </div>

      {showGroupBy || showCompare ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {showGroupBy ? (
            <div aria-label="Agrupar por" className="flex flex-wrap items-center gap-2" role="group">
              <span aria-hidden className="text-sm font-medium text-on-surface">
                Agrupar por
              </span>
              {GROUP_BY_OPTIONS.map((option) => {
                const isActive = (dateFilters.groupBy ?? "auto") === (option.value ?? "auto");

                return (
                  <button
                    aria-pressed={isActive}
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      isActive
                        ? "border-primary bg-primary/10 text-on-surface"
                        : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container-low",
                    )}
                    key={option.label}
                    onClick={() => onDateChange({ groupBy: option.value })}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {showCompare ? (
            <div className="flex flex-col gap-0.5">
              <label
                className="inline-flex cursor-pointer items-center gap-2 text-sm text-on-surface"
                htmlFor={compareId}
              >
                <input
                  checked={Boolean(dateFilters.compare)}
                  className="size-4 cursor-pointer rounded border-outline accent-primary"
                  id={compareId}
                  onChange={(event) => onDateChange({ compare: event.target.checked || undefined })}
                  type="checkbox"
                />
                Comparar con periodo anterior
              </label>
              {dateFilters.compare && !hasFullRange ? (
                <p className="text-xs text-on-surface-variant">
                  Elige un rango de fechas para comparar.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {showSupplier || showProduct ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {showSupplier ? (
            report ? (
              <SupplierFilter
                onChange={(supplierId) => onPurchasesChange({ supplierId })}
                supplierId={purchasesFilters.supplierId}
              />
            ) : (
              <TextIdFilter
                label="Proveedor"
                onChange={(supplierId) => onPurchasesChange({ supplierId })}
                value={purchasesFilters.supplierId}
              />
            )
          ) : null}
          {showProduct ? (
            report ? (
              <InventoryMovementsProductFilter
                onChange={(productId) => onStockCardChange({ productId: productId || undefined })}
                productId={stockCardFilters.productId ?? ""}
              />
            ) : (
              <TextIdFilter
                label="Producto"
                onChange={(productId) => onStockCardChange({ productId })}
                value={stockCardFilters.productId}
              />
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
