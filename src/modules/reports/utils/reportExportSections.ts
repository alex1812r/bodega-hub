import { reportCatalog } from "../reports-list/config/reportCatalog";
import type { ReportsExportDataset, ReportsExportFilters } from "../services/fetchReportsForExport";
import {
  customerPurchasesExportColumns,
  dailySalesExportColumns,
  grossProfitExportColumns,
  lowStockExportColumns,
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
  note?: string;
  periodLabel: string;
  rows: unknown[];
  title: string;
};

export function formatReportExportPeriodLabel(from?: string, to?: string) {
  const start = from?.trim();
  const end = to?.trim();

  if (start && end) {
    return `Periodo: ${start} a ${end}`;
  }

  if (start) {
    return `Desde: ${start}`;
  }

  if (end) {
    return `Hasta: ${end}`;
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
      periodLabel: "Historico de clientes",
      rows: data.customerPurchases,
    },
    "supplier-purchases": {
      columns: supplierPurchasesExportColumns,
      periodLabel: "Historico de proveedores",
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
      title: report.name,
      columns: section.columns as ReportExportColumn<unknown>[],
      periodLabel: section.periodLabel,
      rows: section.rows,
      note: "note" in section ? section.note : undefined,
    };
  });
}
