import { inclusiveIsoDayCount } from "@bodega/core/dashboard";

import { formatExportCount } from "@/modules/inventory/services/fetchExportRows";
import { formatDateRangeLabel } from "@/shared/components/DateRangeField";
import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";

import {
  AGING_BUCKET_LABELS,
  CASH_CLOSE_CURRENCY_LABELS,
} from "../reports-list/components/money/moneyReportText";
import { reportCatalog, storeReportCatalog } from "../reports-list/config/reportCatalog";
import type { ReportsExportDataset, ReportsExportFilters } from "../services/fetchReportsForExport";
import { DEAD_STOCK_DEFAULT_DAYS } from "../services/inventoryReports";
import {
  resolveAutoGroupBy,
  type PurchasesReportStatusFilter,
  type ReportGroupBy,
} from "../services/reportSeries";
import {
  cashCloseDifferencesExportColumns,
  customerPurchasesExportColumns,
  dailyCloseExportColumns,
  dailySalesExportColumns,
  deadStockExportColumns,
  fxDepreciationExportColumns,
  grossProfitExportColumns,
  lowStockExportColumns,
  payablesAgingExportColumns,
  paymentMethodsExportColumns,
  productProfitabilityExportColumns,
  purchasesExportColumns,
  receivablesAgingExportColumns,
  salesByCategoryExportColumns,
  salesByHourExportColumns,
  stockAdjustmentsExportColumns,
  stockCardExportColumns,
  stockTurnoverExportColumns,
  supplierPurchasesExportColumns,
  topCustomersExportColumns,
  topProductsExportColumns,
  type ReportExportColumn,
} from "./reportExportSheetColumns";
import { getActiveExportView } from "./reportExportView";

export type ReportExportSection = {
  columns: ReportExportColumn<unknown>[];
  /**
   * Encabezado bajo el título, una línea por elemento: periodo, agrupación,
   * comparación, filtros, tienda, fecha de generación, notas y aviso de corte.
   * Lo mismo en el PDF, en cada hoja del Excel y en la vista previa.
   */
  headerLines: string[];
  id: string;
  note?: string;
  periodLabel: string;
  rows: unknown[];
  title: string;
  /** La hoja llegó al tope de filas: aviso para el usuario (también va en `headerLines`). */
  truncationNotice?: string;
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

  return "Todas las fechas";
}

/** Nombres de los reportes de inventario mientras el catálogo no los declare. */
const FALLBACK_REPORT_NAMES: Record<string, string> = {
  "dead-stock": "Productos sin movimiento",
  "stock-adjustments": "Ajustes y mermas",
  "stock-turnover": "Rotación de inventario",
};

function findReportDefinition(reportId: string) {
  return storeReportCatalog.find((report) => (report.id as string) === reportId);
}

/** Nombre visible de un reporte («Ventas diarias»); `undefined` si el id no existe. */
export function getReportExportName(reportId: string | undefined) {
  if (!reportId) {
    return undefined;
  }

  return findReportDefinition(reportId)?.name ?? FALLBACK_REPORT_NAMES[reportId];
}

const GROUP_BY_LABELS: Record<ReportGroupBy, string> = {
  day: "Día",
  month: "Mes",
  week: "Semana",
};

const PURCHASE_STATUS_LABELS: Record<PurchasesReportStatusFilter, string> = {
  all: "Todos",
  cancelado: "Cancelado",
  devuelto: "Devuelto",
  pedido: "Pedido",
  recibido: "Recibido",
};

const RANGE_REQUIRED_NOTE =
  "Elige un rango con fecha inicial y final para exportar este reporte.";

/** Texto de un filtro por entidad: su nombre si se conoce, nunca el id interno. */
function entityFilter(label: string, name: string | undefined, selectedText: string) {
  return `${label}: ${name?.trim() || selectedText}`;
}

function findSupplierName(data: ReportsExportDataset, supplierId: string) {
  return (
    data.purchases.find((row) => row.supplierId === supplierId)?.supplier?.name ??
    data.supplierPurchases.find((row) => row.supplierId === supplierId)?.name ??
    data.payablesAging?.find((row) => row.contact?.id === supplierId)?.contact?.name
  );
}

function findCustomerName(data: ReportsExportDataset, customerId: string) {
  return (
    data.receivablesAging?.find((row) => row.contact?.id === customerId)?.contact?.name ??
    data.customerPurchases.find((row) => row.customerId === customerId)?.name ??
    data.topCustomers.find((row) => row.customerId === customerId)?.name
  );
}

function findProductName(data: ReportsExportDataset, productId: string) {
  const movement = data.stockCard.find((row) => row.productId === productId);

  return (
    movement?.productName ??
    data.lowStock.find((row) => row.id === productId)?.name ??
    data.productProfitability.find((row) => row.productId === productId)?.name ??
    data.topProducts.find((row) => row.productId === productId)?.name ??
    movement?.sku
  );
}

/** Filtros propios de una hoja, legibles. Solo los que de verdad acotan sus filas. */
function describeSectionFilters(
  reportId: string,
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
): string[] {
  const active = getActiveExportView(filters.view, reportId);
  const lines: string[] = [];

  switch (reportId) {
    case "purchases": {
      const supplierId = filters.purchasesFilters.supplierId;
      const status = filters.purchasesFilters.status ?? filters.view?.purchasesStatus;

      if (supplierId) {
        lines.push(entityFilter("Proveedor", findSupplierName(data, supplierId), "seleccionado"));
      }

      if (status) {
        lines.push(`Estado: ${PURCHASE_STATUS_LABELS[status]}`);
      }
      break;
    }
    case "receivables-aging":
    case "payables-aging": {
      if (active?.bucket) {
        lines.push(`Tramo: ${AGING_BUCKET_LABELS[active.bucket]}`);
      }

      if (active?.contactId) {
        lines.push(
          reportId === "receivables-aging"
            ? entityFilter("Cliente", findCustomerName(data, active.contactId), "seleccionado")
            : entityFilter("Proveedor", findSupplierName(data, active.contactId), "seleccionado"),
        );
      }
      break;
    }
    case "cash-close-differences":
      if (active) {
        lines.push(`Moneda: ${CASH_CLOSE_CURRENCY_LABELS[active.currency ?? "ves"]}`);
      }
      break;
    case "dead-stock": {
      const categoryId = active?.categoryId;

      lines.push(`Sin vender desde hace ${active?.days ?? DEAD_STOCK_DEFAULT_DAYS} días o más`);

      if (categoryId) {
        lines.push(
          entityFilter(
            "Categoría",
            data.deadStock?.find((row) => row.category.id === categoryId)?.category.name,
            "seleccionada",
          ),
        );
      }
      break;
    }
    case "stock-turnover":
      if (active) {
        lines.push(
          `Agrupado por: ${active.turnoverGroupBy === "category" ? "Categoría" : "Producto"}`,
        );
      }
      break;
    default:
      break;
  }

  return lines;
}

/** Tienda (o alcance de plataforma) del archivo. Sin ids. */
function describeStore(data: ReportsExportDataset, filters: ReportsExportFilters) {
  const scope = filters.scope;

  if (scope?.pathPrefix !== "/api/platform/reports") {
    return data.storeName ? `Tienda: ${data.storeName}` : undefined;
  }

  if (!scope.storeScope || scope.storeScope === "all") {
    return "Tiendas: todas";
  }

  const count = (scope.storeIds ?? "").split(",").filter((id) => id.trim() !== "").length;

  return count === 1 ? "Tiendas: 1 seleccionada" : `Tiendas: ${count} seleccionadas`;
}

type SectionSource = {
  columns: ReportExportColumn<unknown>[];
  id: string;
  note?: string;
  periodLabel: string;
  rows: unknown[];
};

function source<T>(
  id: string,
  columns: ReportExportColumn<T>[],
  rows: readonly T[],
  periodLabel: string,
  note?: string,
): SectionSource {
  return {
    columns: columns as ReportExportColumn<unknown>[],
    id,
    note,
    periodLabel,
    rows: rows as unknown[],
  };
}

/**
 * Una sección por hoja: los 13 reportes multi-tienda (siempre, en el orden del
 * catálogo) y los de la tienda activa que vengan en `data` (los que la sesión
 * puede ver). `exportedAt` añade la fecha de generación al encabezado.
 */
export function buildReportExportSections(
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
  exportedAt?: string,
): ReportExportSection[] {
  const { from, to } = filters.dateFilters;
  const hasFullRange = Boolean(from && to);
  const datePeriod = formatReportExportPeriodLabel(from, to);
  const purchasesPeriod = formatReportExportPeriodLabel(
    filters.purchasesFilters.from,
    filters.purchasesFilters.to,
  );
  const productId = filters.stockCardFilters.productId;
  const rangeNote = hasFullRange ? undefined : RANGE_REQUIRED_NOTE;

  const multiStore: Record<(typeof reportCatalog)[number]["id"], SectionSource> = {
    "daily-close": source("daily-close", dailyCloseExportColumns, data.dailyClose, datePeriod),
    "daily-sales": source("daily-sales", dailySalesExportColumns, data.dailySales, datePeriod),
    "gross-profit": source("gross-profit", grossProfitExportColumns, data.grossProfit, datePeriod),
    "fx-depreciation": source(
      "fx-depreciation",
      fxDepreciationExportColumns,
      data.fxDepreciation,
      datePeriod,
      data.fxDepreciationNote,
    ),
    "payment-methods": source(
      "payment-methods",
      paymentMethodsExportColumns,
      data.paymentMethods,
      datePeriod,
    ),
    "product-profitability": source(
      "product-profitability",
      productProfitabilityExportColumns,
      data.productProfitability,
      "Rentabilidad acumulada",
    ),
    "low-stock": source("low-stock", lowStockExportColumns, data.lowStock, "Stock actual"),
    "customer-purchases": source(
      "customer-purchases",
      customerPurchasesExportColumns,
      data.customerPurchases,
      "Histórico de clientes",
    ),
    "supplier-purchases": source(
      "supplier-purchases",
      supplierPurchasesExportColumns,
      data.supplierPurchases,
      "Histórico de proveedores",
    ),
    "stock-card": source(
      "stock-card",
      stockCardExportColumns,
      data.stockCard,
      productId
        ? entityFilter("Producto", findProductName(data, productId), "seleccionado")
        : "Sin producto seleccionado",
      productId
        ? undefined
        : "Elige un producto en el reporte Kardex de producto para exportar sus movimientos.",
    ),
    "top-products": source("top-products", topProductsExportColumns, data.topProducts, datePeriod),
    "top-customers": source(
      "top-customers",
      topCustomersExportColumns,
      data.topCustomers,
      datePeriod,
    ),
    purchases: source("purchases", purchasesExportColumns, data.purchases, purchasesPeriod),
  };

  const storeOnly = [
    data.salesByHour &&
      source("sales-by-hour", salesByHourExportColumns, data.salesByHour, datePeriod, rangeNote),
    data.salesByCategory &&
      source(
        "sales-by-category",
        salesByCategoryExportColumns,
        data.salesByCategory,
        datePeriod,
        rangeNote,
      ),
    data.receivablesAging &&
      source(
        "receivables-aging",
        receivablesAgingExportColumns,
        data.receivablesAging,
        "Saldos pendientes a la fecha",
      ),
    data.payablesAging &&
      source(
        "payables-aging",
        payablesAgingExportColumns,
        data.payablesAging,
        "Saldos pendientes a la fecha",
      ),
    data.cashCloseDifferences &&
      source(
        "cash-close-differences",
        cashCloseDifferencesExportColumns,
        data.cashCloseDifferences,
        datePeriod,
      ),
    data.deadStock && source("dead-stock", deadStockExportColumns, data.deadStock, "Stock actual"),
    data.stockTurnover &&
      source("stock-turnover", stockTurnoverExportColumns, data.stockTurnover, datePeriod, rangeNote),
    data.stockAdjustments &&
      source(
        "stock-adjustments",
        stockAdjustmentsExportColumns,
        data.stockAdjustments,
        datePeriod,
        rangeNote,
      ),
  ].filter((section): section is SectionSource => section !== undefined);

  const sources = [
    ...reportCatalog.map((report) => multiStore[report.id]),
    ...storeOnly,
  ];
  const storeLine = describeStore(data, filters);
  const generatedLine = exportedAt
    ? `Generado: ${formatCaracasDateTime(exportedAt)} (hora de Caracas)`
    : undefined;

  return sources.map((section) => {
    const definition = findReportDefinition(section.id);
    const active = getActiveExportView(filters.view, section.id);
    const sectionFilters = describeSectionFilters(section.id, data, filters);
    const truncation = data.truncated?.[section.id];
    const truncationNotice = truncation
      ? `Archivo cortado: esta hoja trae las primeras ${formatExportCount(truncation.exported)} filas de ${formatExportCount(truncation.total)}. Acota los filtros para exportar el resto.`
      : undefined;
    const headerLines = [section.periodLabel];

    // Agrupación y comparación son del gráfico del reporte abierto, y el
    // servidor solo las calcula con el rango completo.
    if (active && hasFullRange && from && to) {
      if (definition?.supportsGroupBy) {
        const groupBy = active.groupBy ?? resolveAutoGroupBy(inclusiveIsoDayCount(from, to));

        headerLines.push(`Agrupación: ${GROUP_BY_LABELS[groupBy]}`);
      }

      if (definition?.supportsCompare && active.compare) {
        headerLines.push("Comparado con periodo anterior");
      }
    }

    if (sectionFilters.length > 0) {
      headerLines.push(`Filtros: ${sectionFilters.join(" · ")}`);
    }

    for (const line of [storeLine, generatedLine, section.note, truncationNotice]) {
      if (line) {
        headerLines.push(line);
      }
    }

    return {
      columns: section.columns,
      headerLines,
      id: section.id,
      note: section.note,
      periodLabel: section.periodLabel,
      rows: section.rows,
      title: getReportExportName(section.id) ?? section.id,
      truncationNotice,
    };
  });
}
