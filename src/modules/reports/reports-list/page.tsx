"use client";

import { useMemo } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import { usePermission } from "@/shared/auth/usePermission";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { useUrlPaginationState } from "@/shared/components/Pagination";
import { useUrlListState, withUrlListBoundary } from "@/shared/hooks/useUrlListState";

import { ReportsCatalog } from "./components/ReportsCatalog";
import { ReportsExportActions } from "./components/ReportsExportActions";
import { ReportsListFilters } from "./components/ReportsListFilters";
import { ReportsResultPanel } from "./components/ReportsResultPanel";
import { filterReportsByAccess } from "./config/reportAccess";
import { getReportById, storeReportCatalog } from "./config/reportCatalog";
import {
  reportsListSchema,
  resolveReportsRange,
  serializeMoneyReportFilters,
  serializeReportsRange,
  toMoneyReportFilters,
  toReportsFilters,
  toReportSwitchPatch,
} from "./reportsListParams";

function ReportsList() {
  // Reporte activo, rango, agrupación, comparación, proveedor, producto, tramo,
  // contacto, moneda y página viven en la URL: recarga, "atrás" y un enlace
  // compartido abren lo mismo.
  const list = useUrlListState(reportsListSchema);
  const { setState: setListState, state } = list;
  const pagination = useUrlPaginationState(list);
  const { bucket, compare, contactId, currency, from, groupBy, preset, productId, report, supplierId, to } =
    state;
  const today = getBusinessTodayIsoDate();
  const activeReport = getReportById(report);
  // El catálogo solo ofrece lo que la sesión puede abrir: los reportes de dinero
  // de REP-06 piden permisos propios (misma regla que sus rutas). Mientras la
  // sesión carga no se ofrece ninguno de ellos.
  const { permissions, role } = usePermission();
  const visibleReports = useMemo(
    () => filterReportsByAccess(storeReportCatalog, { permissions, role }),
    [permissions, role],
  );
  const moneyFilters = useMemo(
    () => toMoneyReportFilters({ bucket, contactId, currency }),
    [bucket, contactId, currency],
  );
  // Un `preset` relativo de la URL se recalcula con el hoy operativo. Sin rango
  // en la URL, los reportes con gráfico y fechas abren en sus últimos 30 días.
  const range = useMemo(
    () => resolveReportsRange({ from, preset, to }, today, activeReport),
    [activeReport, from, preset, to, today],
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
        // Cambiar de reporte devuelve la página a 1 (lo hace `useUrlListState`) y
        // limpia tramo, contacto y moneda, que son de un reporte concreto.
        onSelect={(reportId) => setListState(toReportSwitchPatch(reportId))}
        reports={visibleReports}
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
        onDateRangeChange={(next) => setListState(serializeReportsRange(next, activeReport))}
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
        listHref={list.href}
        moneyFilters={moneyFilters}
        onMoneyFiltersChange={(patch) => setListState(serializeMoneyReportFilters(patch))}
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
