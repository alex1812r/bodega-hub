import { Filter } from "lucide-react";

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

type ReportsListFiltersProps = {
  dateFilters: ReportDateRangeFilters;
  onDateChange: (patch: Partial<ReportDateRangeFilters>) => void;
  onPurchasesChange: (patch: Partial<PurchasesReportFilters>) => void;
  onStockCardChange: (patch: Partial<StockCardReportFilters>) => void;
  purchasesFilters: PurchasesReportFilters;
  stockCardFilters: StockCardReportFilters;
};

export function ReportsListFilters({
  dateFilters,
  onDateChange,
  onPurchasesChange,
  onStockCardChange,
  purchasesFilters,
  stockCardFilters,
}: ReportsListFiltersProps) {
  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-on-surface">
        <Filter aria-hidden className="size-5 shrink-0" />
        <h3 className="text-sm font-medium text-foreground">Filtros globales</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="reports-from">
            Desde
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="reports-from"
            onChange={(event) => {
              const from = event.target.value || undefined;
              onDateChange({ from });
              onPurchasesChange({ from });
            }}
            type="date"
            value={dateFilters.from ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="reports-to">
            Hasta
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="reports-to"
            onChange={(event) => {
              const to = event.target.value || undefined;
              onDateChange({ to });
              onPurchasesChange({ to });
            }}
            type="date"
            value={dateFilters.to ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="reports-supplier">
            Proveedor
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="reports-supplier"
            onChange={(event) =>
              onPurchasesChange({
                supplierId: event.target.value.trim() || undefined,
              })
            }
            placeholder="cont-supplier"
            type="text"
            value={purchasesFilters.supplierId ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={stitchListFilterLabelClassName} htmlFor="reports-product">
            Producto
          </label>
          <input
            className={cn(stitchListFilterFieldClassName, "w-full")}
            id="reports-product"
            onChange={(event) =>
              onStockCardChange({
                productId: event.target.value.trim() || undefined,
              })
            }
            placeholder="prod-cable"
            type="text"
            value={stockCardFilters.productId ?? ""}
          />
        </div>
      </div>
    </section>
  );
}
