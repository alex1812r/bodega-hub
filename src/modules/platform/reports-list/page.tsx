"use client";

import { useMemo, useState } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { SelectField } from "@/shared/components/SelectField";
import { ReportsCatalogTable } from "@/modules/reports/reports-list/components/ReportsCatalogTable";
import { ReportsExportActions } from "@/modules/reports/reports-list/components/ReportsExportActions";
import { ReportsListFilters } from "@/modules/reports/reports-list/components/ReportsListFilters";
import { ReportsResultPanel } from "@/modules/reports/reports-list/components/ReportsResultPanel";
import {
  defaultReportId,
  getReportById,
  reportCatalog,
  type ReportId,
} from "@/modules/reports/reports-list/config/reportCatalog";
import type {
  PurchasesReportFilters,
  ReportDateRangeFilters,
  ReportRequestScope,
  StockCardReportFilters,
} from "@/modules/reports/hooks/useReports";

import type { PlatformStoreScope } from "../types/reports";
import { PlatformStoreScopeFilter } from "../components/PlatformStoreScopeFilter";

export function PlatformReportsListPage() {
  const [activeReportId, setActiveReportId] = useState<ReportId>(defaultReportId);
  const [dateFilters, setDateFilters] = useState<ReportDateRangeFilters>({});
  const [stockCardFilters, setStockCardFilters] = useState<StockCardReportFilters>({});
  const [purchasesFilters, setPurchasesFilters] = useState<PurchasesReportFilters>({});
  const [storeScope, setStoreScope] = useState<PlatformStoreScope>("all");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const activeReport = getReportById(activeReportId);

  const scopeReady =
    storeScope === "all" ||
    (storeScope === "one" && selectedStoreIds.length === 1) ||
    (storeScope === "selected" && selectedStoreIds.length > 0);

  const reportScope: ReportRequestScope = useMemo(
    () => ({
      enabled: scopeReady,
      pathPrefix: "/api/platform/reports",
      storeIds: selectedStoreIds.join(","),
      storeScope,
    }),
    [scopeReady, selectedStoreIds, storeScope],
  );

  return (
    <EntityListPage
      actions={
        <ReportsExportActions
          exportFilters={{
            dateFilters,
            purchasesFilters,
            scope: reportScope,
            stockCardFilters,
          }}
        />
      }
      description={`Reportes de plataforma con alcance multi-tienda${getPageDataSourceSuffix()}`}
      layout="sections"
      title="Reportes"
    >
      <PlatformStoreScopeFilter
        description="Genera el reporte para una tienda, varias seleccionadas o todas."
        onScopeChange={setStoreScope}
        onSelectedStoreIdsChange={setSelectedStoreIds}
        scope={storeScope}
        selectedStoreIds={selectedStoreIds}
      />

      <ReportsListFilters
        dateFilters={dateFilters}
        onDateChange={(patch) => setDateFilters((current) => ({ ...current, ...patch }))}
        onPurchasesChange={(patch) =>
          setPurchasesFilters((current) => ({ ...current, ...patch }))
        }
        onStockCardChange={(patch) =>
          setStockCardFilters((current) => ({ ...current, ...patch }))
        }
        purchasesFilters={purchasesFilters}
        stockCardFilters={stockCardFilters}
      />

      <div className="lg:hidden">
        <SelectField
          label="Reporte activo"
          onChange={(event) => setActiveReportId(event.target.value as ReportId)}
          options={reportCatalog.map((report) => ({
            label: report.name,
            value: report.id,
          }))}
          value={activeReportId}
        />
      </div>

      <ReportsCatalogTable
        activeReportId={activeReportId}
        onSelect={setActiveReportId}
        reports={reportCatalog}
      />

      {scopeReady ? (
        <ReportsResultPanel
          dateFilters={dateFilters}
          purchasesFilters={purchasesFilters}
          report={activeReport}
          scope={reportScope}
          stockCardFilters={stockCardFilters}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Selecciona al menos una tienda para generar el reporte.
        </p>
      )}
    </EntityListPage>
  );
}
