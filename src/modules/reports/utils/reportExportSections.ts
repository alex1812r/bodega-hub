import { formatDateRangeLabel } from "@/shared/components/DateRangeField";

import { reportCatalog } from "../reports-list/config/reportCatalog";
import type { ReportsExportDataset, ReportsExportFilters } from "../services/fetchReportsForExport";
import {
  customerPurchasesExportColumns,
  dailyCloseExportColumns,
  dailySalesExportColumns,
  fxDepreciationExportColumns,
  grossProfitExportColumns,
  lowStockExportColumns,
  paymentMethodsExportColumns,
  productProfitabilityExportColumns,
  purchasesExportColumns,
  stockCardExportColumns,
  supplierPurchasesExportColumns,
  topCustomersExportColumns,
  topProductsExportColumns,
  type ReportExportColumn,
} from "./reportExportSheetColumns";

export type ReportExportSection = {
  columns: ReportExportColumn<unknown>[];
  id: string;
  note?: string;
  periodLabel: string;
  rows: unknown[];
  title: string;
};

/** "1 abr 2026". */
function formatExportDay(day: string) {
  return formatDateRangeLabel(day, day);
}

/**
 * Periodo de una hoja en español: "Periodo: del 1 abr 2026 al 30 abr 2026".
 * Sin raya (–): las fuentes estándar del PDF solo dibujan Latin-1.
 */
export function formatReportExportPeriodLabel(from?: string, to?: string) {
  const start = from?.trim();
  const end = to?.trim();

  if (start && end) {
    return start === end
      ? `Periodo: ${formatExportDay(start)}`
      : `Periodo: del ${formatExportDay(start)} al ${formatExportDay(end)}`;
  }

  if (start) {
    return `Desde: ${formatExportDay(start)}`;
  }

  if (end) {
    return `Hasta: ${formatExportDay(end)}`;
  }

  return "Sin filtro de periodo";
}

export function buildReportExportSections(
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
): ReportExportSection[] {
  const datePeriod = formatReportExportPeriodLabel(
    filters.dateFilters.from,
    filters.dateFilters.to,
  );
  const purchasesPeriod = formatReportExportPeriodLabel(
    filters.purchasesFilters.from,
    filters.purchasesFilters.to,
  );
  const stockCardPeriod = filters.stockCardFilters.productId
    ? `Producto: ${filters.stockCardFilters.productId}`
    : "Sin producto seleccionado";

  const sectionsByReportId = {
    "daily-close": {
      columns: dailyCloseExportColumns,
      periodLabel: datePeriod,
      rows: data.dailyClose,
    },
    "daily-sales": {
      columns: dailySalesExportColumns,
      periodLabel: datePeriod,
      rows: data.dailySales,
    },
    "gross-profit": {
      columns: grossProfitExportColumns,
      periodLabel: datePeriod,
      rows: data.grossProfit,
    },
    "fx-depreciation": {
      columns: fxDepreciationExportColumns,
      periodLabel: datePeriod,
      note: data.fxDepreciationNote,
      rows: data.fxDepreciation,
    },
    "payment-methods": {
      columns: paymentMethodsExportColumns,
      periodLabel: datePeriod,
      rows: data.paymentMethods,
    },
    "product-profitability": {
      columns: productProfitabilityExportColumns,
      periodLabel: "Rentabilidad acumulada",
      rows: data.productProfitability,
    },
    "low-stock": {
      columns: lowStockExportColumns,
      periodLabel: "Stock actual",
      rows: data.lowStock,
    },
    "customer-purchases": {
      columns: customerPurchasesExportColumns,
      periodLabel: "Histórico de clientes",
      rows: data.customerPurchases,
    },
    "supplier-purchases": {
      columns: supplierPurchasesExportColumns,
      periodLabel: "Histórico de proveedores",
      rows: data.supplierPurchases,
    },
    "stock-card": {
      columns: stockCardExportColumns,
      note: data.stockCardNote,
      periodLabel: stockCardPeriod,
      rows: data.stockCard,
    },
    "top-products": {
      columns: topProductsExportColumns,
      periodLabel: datePeriod,
      rows: data.topProducts,
    },
    "top-customers": {
      columns: topCustomersExportColumns,
      periodLabel: datePeriod,
      rows: data.topCustomers,
    },
    purchases: {
      columns: purchasesExportColumns,
      periodLabel: purchasesPeriod,
      rows: data.purchases,
    },
  } as const;

  return reportCatalog.map((report) => {
    const section = sectionsByReportId[report.id];

    return {
      id: report.id,
      title: report.name,
      columns: section.columns as ReportExportColumn<unknown>[],
      periodLabel: section.periodLabel,
      rows: section.rows,
      note: "note" in section ? section.note : undefined,
    };
  });
}
