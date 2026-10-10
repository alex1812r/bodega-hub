"use client";

import { usePermission } from "@/shared/auth/usePermission";
import { LoadingState } from "@/shared/components/LoadingState";
import { usePaginationState } from "@/shared/components/Pagination";

import { canViewReport } from "../../config/reportAccess";
import type { ReportDefinition } from "../../config/reportCatalog";
import { useReportPanelReady } from "../../reportPanelReady";
import { DEFAULT_CASH_CLOSE_CURRENCY, type MoneyReportFilters } from "../../reportsListParams";
import type { ReportPagination } from "../ReportTable";
import { AgingReportPanel } from "./AgingReportPanel";
import { CashCloseDifferencesReportPanel } from "./CashCloseDifferencesReportPanel";
import { ReportForbiddenState } from "./ReportStates";
import { SalesByCategoryReportPanel } from "./SalesByCategoryReportPanel";
import { SalesByHourReportPanel } from "./SalesByHourReportPanel";

const NO_FILTERS: MoneyReportFilters = { currency: DEFAULT_CASH_CLOSE_CURRENCY };

type MoneyReportPanelProps = {
  /** Rango ya recortado a lo que el reporte admite (`toReportDateFilters`). */
  dateFilters: { from?: string; to?: string };
  filters?: MoneyReportFilters;
  /** URL actual de la lista, para el `returnTo` de los enlaces. */
  listHref?: string;
  onFiltersChange?: (patch: Partial<MoneyReportFilters>) => void;
  /** Paginación guardada fuera (URL). Sin ella el panel lleva la suya. */
  pagination?: ReportPagination;
  report: ReportDefinition;
};

function ignoreFiltersChange() {}

/**
 * Los cinco reportes de dinero de REP-06, de la tienda activa. Antes de montar
 * el reporte comprueba el permiso con la misma regla que su ruta: sin permiso
 * muestra el 403 del tema y NO llega a pedir nada al servidor.
 */
export function MoneyReportPanel({
  dateFilters,
  filters = NO_FILTERS,
  listHref,
  onFiltersChange = ignoreFiltersChange,
  pagination: externalPagination,
  report,
}: MoneyReportPanelProps) {
  const { isLoading, permissions, role } = usePermission();
  const localPagination = usePaginationState([report.id, filters.bucket, filters.contactId, filters.currency]);
  const pagination = externalPagination ?? localPagination;
  const range = { from: dateFilters.from, to: dateFilters.to };
  const canView = canViewReport(report.id, { permissions, role });

  // Sin permiso no se monta ningún reporte: el 403 ya es el contenido final del panel.
  useReportPanelReady(!isLoading && !canView);

  if (isLoading) {
    return <LoadingState description="Comprobando permisos del reporte." title="Cargando reporte" />;
  }

  if (!canView) {
    return <ReportForbiddenState reportName={report.name} />;
  }

  switch (report.id) {
    case "sales-by-hour":
      return <SalesByHourReportPanel range={range} report={report} />;
    case "sales-by-category":
      return <SalesByCategoryReportPanel range={range} report={report} />;
    case "receivables-aging":
    case "payables-aging":
      return (
        <AgingReportPanel
          bucket={filters.bucket}
          contactId={filters.contactId}
          kind={report.id === "receivables-aging" ? "receivables" : "payables"}
          listHref={listHref}
          onFiltersChange={onFiltersChange}
          pagination={pagination}
          report={report}
        />
      );
    case "cash-close-differences":
      return (
        <CashCloseDifferencesReportPanel
          currency={filters.currency}
          onCurrencyChange={(currency) => onFiltersChange({ currency })}
          pagination={pagination}
          range={range}
          report={report}
        />
      );
    default:
      return null;
  }
}
