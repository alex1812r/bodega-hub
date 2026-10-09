"use client";

import { useMemo } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import { serializeDateRange } from "@/shared/components/DateRangeField";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { useUrlPaginationState } from "@/shared/components/Pagination";
import { useUrlListState, withUrlListBoundary } from "@/shared/hooks/useUrlListState";

import { ReportsCatalog } from "./components/ReportsCatalog";
import { ReportsExportActions } from "./components/ReportsExportActions";
import { ReportsListFilters } from "./components/ReportsListFilters";
import { ReportsResultPanel } from "./components/ReportsResultPanel";
import { getReportById, reportCatalog } from "./config/reportCatalog";
import { reportsListSchema, resolveReportsRange, toReportsFilters } from "./reportsListParams";

function ReportsList() {
  // Reporte activo, rango, agrupación, comparación, proveedor, producto y página
  // viven en la URL: recarga, "atrás" y un enlace compartido abren lo mismo.
  const list = useUrlListState(reportsListSchema);
  const { setState: setListState, state } = list;
  const pagination = useUrlPaginationState(list);
  const { compare, from, groupBy, preset, productId, report, supplierId, to } = state;
  const today = getBusinessTodayIsoDate();
  const activeReport = getReportById(report);
  // Un `preset` relativo de la URL se recalcula con el hoy operativo.
  const range = useMemo(
    () => resolveReportsRange({ from, preset, to }, today),
    [from, preset, to, today],
  );
  const filters = useMemo(
    () => toReportsFilters({ compare, groupBy, productId, supplierId }, range),
    [compare, groupBy, productId, range, supplierId],
  );

  return (
    <EntityListPage
      actions={<ReportsExportActions exportFilters={filters} />}
      description={`Genera, visualiza y exporta información clave de tu negocio${getPageDataSourceSuffix()}`}
      layout="sections"
      title="Reportes"
    >
      <ReportsCatalog
        activeReportId={report}
        // Cambiar de reporte devuelve la página a 1 (lo hace `useUrlListState`).
        onSelect={(reportId) => setListState({ report: reportId })}
        reports={reportCatalog}
      />

      <ReportsListFilters
        dateFilters={filters.dateFilters}
        datePreset={range.preset}
        onDateChange={(patch) => {
          if ("groupBy" in patch) {
            setListState({ groupBy: patch.groupBy === "auto" ? "" : (patch.groupBy ?? "") });
          }

          if ("compare" in patch) {
            setListState({ compare: patch.compare ? "1" : "" });
          }
        }}
        onDateRangeChange={(next) => setListState(serializeDateRange(next))}
        onPurchasesChange={(patch) => {
          if ("supplierId" in patch) {
            setListState({ supplierId: patch.supplierId ?? "" });
          }
        }}
        onStockCardChange={(patch) => {
          if ("productId" in patch) {
            setListState({ productId: patch.productId ?? "" });
          }
        }}
        purchasesFilters={filters.purchasesFilters}
        report={activeReport}
        stockCardFilters={filters.stockCardFilters}
        today={today}
      />

      <ReportsResultPanel
        dateFilters={filters.dateFilters}
        pagination={pagination}
        purchasesFilters={filters.purchasesFilters}
        report={activeReport}
        stockCardFilters={filters.stockCardFilters}
      />
    </EntityListPage>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const ReportsListPage = withUrlListBoundary(ReportsList);
