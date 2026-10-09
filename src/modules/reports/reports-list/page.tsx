"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import { usePermission } from "@/shared/auth/usePermission";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { useUrlPaginationState } from "@/shared/components/Pagination";
import { useUrlListState, withUrlListBoundary } from "@/shared/hooks/useUrlListState";

import { InvalidUrlRangeNotice } from "./components/InvalidUrlRangeNotice";
import { ReportsCatalog } from "./components/ReportsCatalog";
import { ReportsExportActions } from "./components/ReportsExportActions";
import { ReportsListFilters } from "./components/ReportsListFilters";
import { ReportsResultPanel } from "./components/ReportsResultPanel";
import { filterReportsByAccess } from "./config/reportAccess";
import { getReportById, storeReportCatalog } from "./config/reportCatalog";
import {
  reportsListSchema,
  resolveReportsRange,
  serializeInventoryReportFilters,
  serializeMoneyReportFilters,
  serializeReportsRange,
  toInventoryReportFilters,
  toMoneyReportFilters,
  toReportsFilters,
  toReportSwitchPatch,
} from "./reportsListParams";
import { sanitizeUrlRange } from "./urlDateRange";

function ReportsList() {
  // Reporte activo, rango, agrupación, comparación, proveedor, estado, producto,
  // tramo, contacto, moneda, días, categoría, agrupación de la rotación y página
  // viven en la URL: recarga, "atrás" y un enlace compartido abren lo mismo.
  const list = useUrlListState(reportsListSchema);
  const { setState: setListState, state } = list;
  const pagination = useUrlPaginationState(list);
  const {
    bucket,
    categoryId,
    compare,
    contactId,
    currency,
    days,
    from,
    groupBy,
    preset,
    productId,
    report,
    status,
    supplierId,
    to,
    turnoverBy,
  } = state;
  const today = getBusinessTodayIsoDate();
  const activeReport = getReportById(report);
  // Un rango de la URL invertido, con el año fuera de rango o mal formado no se
  // usa ni viaja al servidor: el reporte abre en su rango por defecto y se avisa.
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  const urlRange = useMemo(
    () => sanitizeUrlRange({ from, to }, { from: rawFrom, to: rawTo }, today),
    [from, rawFrom, rawTo, to, today],
  );
  // El catálogo solo ofrece lo que la sesión puede abrir: los reportes de dinero
  // de REP-06 y los de inventario de REP-07 piden permisos propios (misma regla
  // que sus rutas). Mientras la sesión carga no se ofrece ninguno de ellos.
  const { permissions, role } = usePermission();
  const visibleReports = useMemo(
    () => filterReportsByAccess(storeReportCatalog, { permissions, role }),
    [permissions, role],
  );
  const moneyFilters = useMemo(
    () => toMoneyReportFilters({ bucket, contactId, currency }),
    [bucket, contactId, currency],
  );
  const inventoryFilters = useMemo(
    () => toInventoryReportFilters({ categoryId, days, turnoverBy }),
    [categoryId, days, turnoverBy],
  );
  // Un `preset` relativo de la URL se recalcula con el hoy operativo. Sin rango
  // en la URL, los reportes con gráfico y fechas abren en sus últimos 30 días.
  const range = useMemo(
    () => resolveReportsRange({ from: urlRange.from, preset, to: urlRange.to }, today, activeReport),
    [activeReport, preset, today, urlRange],
  );
  const filters = useMemo(
    () => toReportsFilters({ compare, groupBy, productId, status, supplierId }, range),
    [compare, groupBy, productId, range, status, supplierId],
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
        // limpia tramo, contacto, moneda, estado, días, categoría y agrupación de
        // la rotación, que son de un reporte concreto.
        onSelect={(reportId) => setListState(toReportSwitchPatch(reportId))}
        reports={visibleReports}
      />

      <InvalidUrlRangeNotice show={urlRange.wasInvalid} />

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

          if ("status" in patch) {
            setListState({ status: patch.status ?? "" });
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
        inventoryFilters={inventoryFilters}
        listHref={list.href}
        moneyFilters={moneyFilters}
        onInventoryFiltersChange={(patch) => setListState(serializeInventoryReportFilters(patch))}
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
