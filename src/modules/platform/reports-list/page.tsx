"use client";

import { useMemo } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { SelectField } from "@/shared/components/SelectField";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { ReportsCatalogTable } from "@/modules/reports/reports-list/components/ReportsCatalogTable";
import { ReportsExportActions } from "@/modules/reports/reports-list/components/ReportsExportActions";
import { ReportsListFilters } from "@/modules/reports/reports-list/components/ReportsListFilters";
import { ReportsResultPanel } from "@/modules/reports/reports-list/components/ReportsResultPanel";
import {
  getReportById,
  reportCatalog,
  type ReportId,
} from "@/modules/reports/reports-list/config/reportCatalog";

import { PlatformStoreScopeFilter } from "../components/PlatformStoreScopeFilter";
import {
  PLATFORM_REPORTS_TEXT_FIELDS,
  platformReportsListSchema,
  toPlatformReportFilters,
  toPlatformReportScope,
  toSelectedStoreIds,
} from "./reportsListParams";

function PlatformReportsList() {
  // Reporte activo, rango, proveedor, producto y alcance de tiendas viven en la
  // URL: recarga, "atrás" y un enlace compartido abren el mismo reporte.
  const list = useUrlListState(platformReportsListSchema, {
    textFields: PLATFORM_REPORTS_TEXT_FIELDS,
  });
  const { setState: setListState, state } = list;
  const { from, product, report, scope, store, supplier, to } = state;
  // Los campos reflejan lo tecleado al instante; los reportes esperan lo mismo que la URL.
  const debouncedSupplier = useDebouncedValue(supplier, URL_LIST_DEBOUNCE_MS);
  const debouncedProduct = useDebouncedValue(product, URL_LIST_DEBOUNCE_MS);
  const activeReport = getReportById(report);
  const selectedStoreIds = useMemo(() => toSelectedStoreIds({ scope, store }), [scope, store]);
  const reportScope = useMemo(() => toPlatformReportScope({ scope, store }), [scope, store]);
  const typedFilters = useMemo(
    () => toPlatformReportFilters({ from, to }, supplier, product),
    [from, product, supplier, to],
  );
  const filters = useMemo(
    () => toPlatformReportFilters({ from, to }, debouncedSupplier, debouncedProduct),
    [debouncedProduct, debouncedSupplier, from, to],
  );

  function selectReport(reportId: ReportId) {
    setListState({ report: reportId });
  }

  return (
    <EntityListPage
      actions={<ReportsExportActions exportFilters={{ ...filters, scope: reportScope }} />}
      description={`Reportes de plataforma con alcance multi-tienda${getPageDataSourceSuffix()}`}
      layout="sections"
      title="Reportes"
    >
      <PlatformStoreScopeFilter
        description="Genera el reporte para una tienda, varias seleccionadas o todas."
        onScopeChange={(nextScope) => setListState({ scope: nextScope })}
        onSelectedStoreIdsChange={(storeIds) => setListState({ store: storeIds })}
        scope={scope}
        selectedStoreIds={selectedStoreIds}
      />

      <ReportsListFilters
        dateFilters={typedFilters.dateFilters}
        onDateChange={(patch) => {
          if ("from" in patch) {
            setListState({ from: patch.from ?? "" });
          }
          if ("to" in patch) {
            setListState({ to: patch.to ?? "" });
          }
        }}
        onPurchasesChange={(patch) => {
          // El rango ya lo escribe `onDateChange`; de compras solo queda el proveedor.
          if ("supplierId" in patch) {
            setListState({ supplier: patch.supplierId ?? "" });
          }
        }}
        onStockCardChange={(patch) => {
          if ("productId" in patch) {
            setListState({ product: patch.productId ?? "" });
          }
        }}
        purchasesFilters={typedFilters.purchasesFilters}
        stockCardFilters={typedFilters.stockCardFilters}
      />

      <div className="lg:hidden">
        <SelectField
          label="Reporte activo"
          onChange={(event) =>
            // El schema valida el valor: uno que no conoce anula el cambio.
            selectReport(event.target.value as ReportId)
          }
          options={reportCatalog.map((item) => ({
            label: item.name,
            value: item.id,
          }))}
          value={report}
        />
      </div>

      <ReportsCatalogTable activeReportId={report} onSelect={selectReport} reports={reportCatalog} />

      {reportScope.enabled ? (
        <ReportsResultPanel
          dateFilters={filters.dateFilters}
          purchasesFilters={filters.purchasesFilters}
          report={activeReport}
          scope={reportScope}
          stockCardFilters={filters.stockCardFilters}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Selecciona al menos una tienda para generar el reporte.
        </p>
      )}
    </EntityListPage>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const PlatformReportsListPage = withUrlListBoundary(PlatformReportsList);
