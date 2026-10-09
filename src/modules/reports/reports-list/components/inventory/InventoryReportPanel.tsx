"use client";

import { usePermission } from "@/shared/auth/usePermission";
import { LoadingState } from "@/shared/components/LoadingState";
import { usePaginationState } from "@/shared/components/Pagination";

import { DEAD_STOCK_DEFAULT_DAYS } from "../../../services/inventoryReports";
import type { ReportGroupBy } from "../../../services/reportSeries";
import { canViewReport } from "../../config/reportAccess";
import type { ReportDefinition } from "../../config/reportCatalog";
import { DEFAULT_TURNOVER_BY, type InventoryReportFilters } from "../../reportsListParams";
import { ReportForbiddenState } from "../money/ReportStates";
import type { ReportPagination } from "../ReportTable";
import { DeadStockReportPanel } from "./DeadStockReportPanel";
import { StockAdjustmentsReportPanel } from "./StockAdjustmentsReportPanel";
import { StockTurnoverReportPanel } from "./StockTurnoverReportPanel";

const NO_FILTERS: InventoryReportFilters = {
  days: DEAD_STOCK_DEFAULT_DAYS,
  turnoverBy: DEFAULT_TURNOVER_BY,
};

type InventoryReportPanelProps = {
  /** Rango y agrupación ya recortados a lo que el reporte admite (`toReportDateFilters`). */
  dateFilters: { from?: string; groupBy?: ReportGroupBy | "auto"; to?: string };
  filters?: InventoryReportFilters;
  /** URL actual de la lista, para el `returnTo` de los enlaces. */
  listHref?: string;
  onFiltersChange?: (patch: Partial<InventoryReportFilters>) => void;
  /** Paginación guardada fuera (URL). Sin ella el panel lleva la suya. */
  pagination?: ReportPagination;
  report: ReportDefinition;
};

function ignoreFiltersChange() {}

/**
 * Los tres reportes de inventario de REP-07, de la tienda activa. Antes de
 * montar el reporte comprueba el permiso con la misma regla que su ruta
 * (`reports.view` + `inventory.view`): sin permiso muestra el 403 del tema y NO
 * llega a pedir nada al servidor.
 */
export function InventoryReportPanel({
  dateFilters,
  filters = NO_FILTERS,
  listHref,
  onFiltersChange = ignoreFiltersChange,
  pagination: externalPagination,
  report,
}: InventoryReportPanelProps) {
  const { isLoading, permissions, role } = usePermission();
  const localPagination = usePaginationState([
    report.id,
    filters.categoryId,
    filters.days,
    filters.turnoverBy,
    dateFilters.from,
    dateFilters.to,
    dateFilters.groupBy,
  ]);
  const pagination = externalPagination ?? localPagination;
  const range = { from: dateFilters.from, to: dateFilters.to };

  if (isLoading) {
    return <LoadingState description="Comprobando permisos del reporte." title="Cargando reporte" />;
  }

  if (!canViewReport(report.id, { permissions, role })) {
    return <ReportForbiddenState reportName={report.name} />;
  }

  switch (report.id) {
    case "dead-stock":
      return (
        <DeadStockReportPanel
          categoryId={filters.categoryId}
          days={filters.days}
          listHref={listHref}
          onFiltersChange={onFiltersChange}
          pagination={pagination}
          report={report}
        />
      );
    case "stock-turnover":
      return (
        <StockTurnoverReportPanel
          listHref={listHref}
          onTurnoverByChange={(turnoverBy) => onFiltersChange({ turnoverBy })}
          pagination={pagination}
          range={range}
          report={report}
          turnoverBy={filters.turnoverBy}
        />
      );
    case "stock-adjustments":
      return (
        <StockAdjustmentsReportPanel
          groupBy={dateFilters.groupBy}
          listHref={listHref}
          pagination={pagination}
          range={range}
          report={report}
        />
      );
    default:
      return null;
  }
}
