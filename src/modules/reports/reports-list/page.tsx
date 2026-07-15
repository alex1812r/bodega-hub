"use client";

import { useState } from "react";

import { getPageDataSourceSuffix } from "@/lib/api/dataSourceUi";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { SelectField } from "@/shared/components/SelectField";

import type {
  PurchasesReportFilters,
  ReportDateRangeFilters,
  StockCardReportFilters,
} from "../hooks/useReports";
import { ReportsCatalogTable } from "./components/ReportsCatalogTable";
import { ReportsExportActions } from "./components/ReportsExportActions";
import { ReportsListFilters } from "./components/ReportsListFilters";
import { ReportsResultPanel } from "./components/ReportsResultPanel";
import {
  defaultReportId,
  getReportById,
  reportCatalog,
  type ReportId,
} from "./config/reportCatalog";

export function ReportsListPage() {
  const [activeReportId, setActiveReportId] = useState<ReportId>(defaultReportId);
  const [dateFilters, setDateFilters] = useState<ReportDateRangeFilters>({});
  const [stockCardFilters, setStockCardFilters] = useState<StockCardReportFilters>({});
  const [purchasesFilters, setPurchasesFilters] = useState<PurchasesReportFilters>({});
  const activeReport = getReportById(activeReportId);

  return (
    <EntityListPage
      actions={
        <ReportsExportActions
          exportFilters={{
            dateFilters,
            purchasesFilters,
            stockCardFilters,
          }}
        />
      }
      description={`Genera, visualiza y exporta informacion clave de tu negocio${getPageDataSourceSuffix()}`}
      layout="sections"
      title="Reportes"
    >
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

      <ReportsResultPanel
        dateFilters={dateFilters}
        purchasesFilters={purchasesFilters}
        report={activeReport}
        stockCardFilters={stockCardFilters}
      />
    </EntityListPage>
  );
}
