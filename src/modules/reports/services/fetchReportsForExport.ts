import { type ExportRows, fetchExportRows } from "@/modules/inventory/services/fetchExportRows";
import { apiFetch } from "@/shared/api/apiFetch";
import type { AppSettingsMock } from "@/shared/mocks/erp-data";

import type {
  CustomerPurchasesReportRow,
  DailySalesReportRow,
  FxDepreciationReportRow,
  GrossProfitReportRow,
  LowStockReportRow,
  PaymentMethodReportRow,
  ProductProfitabilityReportRow,
  PurchasesReportFilters,
  PurchasesReportRow,
  ReportDateRangeFilters,
  ReportRequestScope,
  StockCardReportFilters,
  StockCardReportRow,
  SupplierPurchasesReportRow,
  TopCustomersReportRow,
  TopProductsReportRow,
} from "../hooks/useReports";
import { WEEKDAYS } from "../reports-list/components/money/moneyReportText";
import { canViewReport } from "../reports-list/config/reportAccess";
import type { DailyCloseExportRow, SalesByHourExportRow } from "../utils/reportExportSheetColumns";
import { getActiveExportView, type ReportsExportView } from "../utils/reportExportView";
import type { DailyCloseSummary } from "./dailyCloseSummary";
import { fetchKeyedExportRows } from "./fetchReportExportRows";
import {
  assertInventoryReportAccess,
  type DeadStockRow,
  type StockAdjustmentRow,
  type StockTurnoverRow,
} from "./inventoryReports";
import type {
  AgingDocumentRow,
  CashCloseDifferenceRow,
  MoneyReportSlug,
  SalesByCategoryReport,
  SalesByCategoryRow,
  SalesByHourReport,
} from "./moneyReports";

export type ReportsExportFilters = {
  dateFilters: Pick<ReportDateRangeFilters, "from" | "to">;
  purchasesFilters: Pick<PurchasesReportFilters, "from" | "status" | "supplierId" | "to">;
  scope?: ReportRequestScope;
  stockCardFilters: Pick<StockCardReportFilters, "productId">;
  /**
   * Lo que se ve en `/reports` (reporte activo y sus filtros). Solo por tienda:
   * con él entran además los reportes de la tienda activa que la sesión puede
   * ver. Sin él (plataforma) se exportan los 13 reportes multi-tienda.
   */
  view?: ReportsExportView;
};

/** Una hoja que llegó al tope de filas: cuántas salen y cuántas había. */
export type ReportsExportTruncation = { exported: number; total: number };

export type ReportsExportDataset = {
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  cashCloseDifferences?: CashCloseDifferenceRow[];
  customerPurchases: CustomerPurchasesReportRow[];
  dailyClose: DailyCloseExportRow[];
  dailySales: DailySalesReportRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  deadStock?: DeadStockRow[];
  fxDepreciation: FxDepreciationReportRow[];
  fxDepreciationNote?: string;
  grossProfit: GrossProfitReportRow[];
  lowStock: LowStockReportRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  payablesAging?: AgingDocumentRow[];
  paymentMethods: PaymentMethodReportRow[];
  productProfitability: ProductProfitabilityReportRow[];
  purchases: PurchasesReportRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  receivablesAging?: AgingDocumentRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  salesByCategory?: SalesByCategoryRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  salesByHour?: SalesByHourExportRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  stockAdjustments?: StockAdjustmentRow[];
  stockCard: StockCardReportRow[];
  /** Solo por tienda y con permiso; ausente = la hoja no se exporta. */
  stockTurnover?: StockTurnoverRow[];
  /** Nombre del negocio de la tienda activa, si se pudo leer. */
  storeName?: string;
  supplierPurchases: SupplierPurchasesReportRow[];
  topCustomers: TopCustomersReportRow[];
  topProducts: TopProductsReportRow[];
  /** Hojas cortadas en el tope de filas, por id de reporte. */
  truncated?: Partial<Record<string, ReportsExportTruncation>>;
};

type ExportQuery = Record<string, number | string | undefined>;

function pickDateQuery(filters: Pick<ReportDateRangeFilters, "from" | "to">) {
  return {
    from: filters.from,
    to: filters.to,
  };
}

function pickPurchasesQuery(filters: ReportsExportFilters) {
  return {
    from: filters.purchasesFilters.from,
    // El mismo estado que se ve en pantalla: lo exportado cuadra con la tabla.
    status: filters.purchasesFilters.status ?? filters.view?.purchasesStatus,
    supplierId: filters.purchasesFilters.supplierId,
    to: filters.purchasesFilters.to,
  };
}

function reportExportPath(slug: string, scope?: ReportRequestScope) {
  const prefix = scope?.pathPrefix ?? "/api/reports";
  return `${prefix}/${slug}`;
}

function withExportScopeQuery(query: ExportQuery, scope?: ReportRequestScope): ExportQuery {
  if (scope?.pathPrefix !== "/api/platform/reports") {
    return query;
  }

  return {
    ...query,
    storeIds: scope.storeIds,
    storeScope: scope.storeScope ?? "all",
  };
}

/** Clave de una fila agregada: su entidad y, en plataforma, la tienda. */
function storeKey(row: { storeId?: string | null }, key: string) {
  return `${row.storeId ?? ""}|${key}`;
}

/** Anota las hojas que llegaron al tope y devuelve solo sus filas. */
function createRowCollector() {
  const truncated: Partial<Record<string, ReportsExportTruncation>> = {};

  return {
    async collect<T>(reportId: string, pending: Promise<ExportRows<T>>): Promise<T[]> {
      const result = await pending;

      if (result.truncated) {
        truncated[reportId] = { exported: result.rows.length, total: result.total };
      }

      return result.rows;
    },
    truncated,
  };
}

type RowCollector = ReturnType<typeof createRowCollector>;

/**
 * Consulta la API en el momento de exportar (sin cache de UI). Toda lista
 * paginada va sin filas repetidas y con tope de filas (`fetchExportRows`); las
 * hojas cortadas quedan en `truncated`.
 */
export async function fetchReportsForExport(
  filters: ReportsExportFilters,
): Promise<ReportsExportDataset> {
  const scope = filters.scope;
  const collector = createRowCollector();
  const dateQuery = withExportScopeQuery(pickDateQuery(filters.dateFilters), scope);
  const scopeQuery = withExportScopeQuery({}, scope);
  const purchasesQuery = withExportScopeQuery(pickPurchasesQuery(filters), scope);
  const productId = filters.stockCardFilters.productId?.trim();
  const path = (slug: string) => reportExportPath(slug, scope);

  const [
    dailyClose,
    dailySales,
    grossProfit,
    fxDepreciationResult,
    paymentMethods,
    productProfitability,
    lowStock,
    customerPurchases,
    supplierPurchases,
    stockCard,
    topProducts,
    topCustomers,
    purchases,
    storeReports,
  ] = await Promise.all([
    fetchDailyCloseForExport(scope, dateQuery),
    collector.collect(
      "daily-sales",
      fetchKeyedExportRows<DailySalesReportRow>(path("daily-sales"), dateQuery, (row) =>
        storeKey(row, row.saleDate),
      ),
    ),
    collector.collect(
      "gross-profit",
      fetchKeyedExportRows<GrossProfitReportRow>(path("gross-profit"), dateQuery, (row) =>
        storeKey(row, row.saleDate),
      ),
    ),
    fetchFxDepreciationForExport(scope, dateQuery, collector),
    collector.collect(
      "payment-methods",
      // La fila no trae tienda: solo se descarta una fila idéntica a otra.
      fetchKeyedExportRows<PaymentMethodReportRow>(path("payment-methods"), dateQuery, (row) =>
        JSON.stringify(row),
      ),
    ),
    collector.collect(
      "product-profitability",
      fetchKeyedExportRows<ProductProfitabilityReportRow>(
        path("product-profitability"),
        scopeQuery,
        (row) => storeKey(row, row.productId),
      ),
    ),
    collector.collect(
      "low-stock",
      fetchExportRows<LowStockReportRow>(path("low-stock"), scopeQuery),
    ),
    collector.collect(
      "customer-purchases",
      fetchKeyedExportRows<CustomerPurchasesReportRow>(
        path("customer-purchases"),
        scopeQuery,
        (row) => storeKey(row, row.customerId),
      ),
    ),
    collector.collect(
      "supplier-purchases",
      fetchKeyedExportRows<SupplierPurchasesReportRow>(
        path("supplier-purchases"),
        scopeQuery,
        (row) => storeKey(row, row.supplierId),
      ),
    ),
    productId
      ? collector.collect(
          "stock-card",
          fetchExportRows<StockCardReportRow>(path("stock-card"), { ...scopeQuery, productId }),
        )
      : Promise.resolve<StockCardReportRow[]>([]),
    collector.collect(
      "top-products",
      fetchKeyedExportRows<TopProductsReportRow>(path("top-products"), dateQuery, (row) =>
        storeKey(row, row.productId),
      ),
    ),
    collector.collect(
      "top-customers",
      fetchKeyedExportRows<TopCustomersReportRow>(path("top-customers"), dateQuery, (row) =>
        storeKey(row, row.customerId),
      ),
    ),
    collector.collect(
      "purchases",
      fetchExportRows<PurchasesReportRow>(path("purchases"), purchasesQuery),
    ),
    fetchStoreReportsForExport(filters, collector),
  ]);

  const hasTruncatedSheets = Object.keys(collector.truncated).length > 0;

  return {
    customerPurchases,
    dailyClose,
    dailySales,
    fxDepreciation: fxDepreciationResult.rows,
    fxDepreciationNote: fxDepreciationResult.note,
    grossProfit,
    lowStock,
    paymentMethods,
    productProfitability,
    purchases,
    stockCard,
    supplierPurchases,
    topCustomers,
    topProducts,
    ...storeReports,
    ...(hasTruncatedSheets ? { truncated: collector.truncated } : {}),
  };
}

type StoreReportsDataset = Pick<
  ReportsExportDataset,
  | "cashCloseDifferences"
  | "deadStock"
  | "payablesAging"
  | "receivablesAging"
  | "salesByCategory"
  | "salesByHour"
  | "stockAdjustments"
  | "stockTurnover"
  | "storeName"
>;

function flattenSalesByHour(report: SalesByHourReport): SalesByHourExportRow[] {
  return report.matrix.flatMap((hours, weekdayIndex) =>
    hours.flatMap((cell, hour) =>
      cell.salesCount > 0
        ? [{ ...cell, hour, weekday: WEEKDAYS[weekdayIndex]?.name ?? String(weekdayIndex + 1) }]
        : [],
    ),
  );
}

/**
 * Nombre de la tienda para el encabezado. Sale de `GET /api/settings`, que
 * exige `settings.view`: sin ese permiso no se pide (daría 403 en la red) y el
 * archivo sale sin la línea «Tienda».
 */
async function fetchStoreName(viewer: ReportsExportView["viewer"]) {
  if (!viewer.permissions.includes("settings.view")) {
    return undefined;
  }

  try {
    const settings = await apiFetch<Pick<AppSettingsMock, "businessName">>("/api/settings");

    return settings.businessName?.trim() || undefined;
  } catch {
    // Sin permiso sobre la configuración el archivo sale sin el nombre de la tienda.
    return undefined;
  }
}

/**
 * Reportes que solo existen para la tienda activa (dinero de REP-06 e
 * inventario de REP-07). Solo se piden los que la sesión puede ver: sus rutas
 * dan 403 al resto. En plataforma, o sin la vista de `/reports`, ninguno.
 */
async function fetchStoreReportsForExport(
  filters: ReportsExportFilters,
  collector: RowCollector,
): Promise<StoreReportsDataset> {
  const view = filters.view;

  if (!view || filters.scope) {
    return {};
  }

  const { from, to } = filters.dateFilters;
  const range = from && to ? { from, to } : null;
  const canViewMoney = (slug: MoneyReportSlug) => canViewReport(slug, view.viewer);
  const canViewInventory = canViewInventoryReports(view);
  const agingQuery = (slug: "payables-aging" | "receivables-aging"): ExportQuery => {
    const active = getActiveExportView(view, slug);

    return { bucket: active?.bucket, contactId: active?.contactId };
  };
  const agingRows = (slug: "payables-aging" | "receivables-aging") =>
    canViewMoney(slug)
      ? collector.collect(
          slug,
          fetchKeyedExportRows<AgingDocumentRow>(
            reportExportPath(slug),
            agingQuery(slug),
            (row) => row.document.id,
          ),
        )
      : undefined;
  const cashCloseView = getActiveExportView(view, "cash-close-differences");
  const deadStockView = getActiveExportView(view, "dead-stock");
  const turnoverView = getActiveExportView(view, "stock-turnover");

  const [
    storeName,
    salesByHour,
    salesByCategory,
    receivablesAging,
    payablesAging,
    cashCloseDifferences,
    deadStock,
    stockTurnover,
    stockAdjustments,
  ] = await Promise.all([
    fetchStoreName(view.viewer),
    // Las rutas con rango obligatorio no se piden sin él: la hoja sale vacía con su aviso.
    canViewMoney("sales-by-hour")
      ? range
        ? apiFetch<SalesByHourReport>(reportExportPath("sales-by-hour"), { query: range }).then(
            flattenSalesByHour,
          )
        : []
      : undefined,
    canViewMoney("sales-by-category")
      ? range
        ? apiFetch<SalesByCategoryReport>(reportExportPath("sales-by-category"), {
            query: range,
          }).then((report) => report.items)
        : []
      : undefined,
    agingRows("receivables-aging"),
    agingRows("payables-aging"),
    canViewMoney("cash-close-differences")
      ? collector.collect(
          "cash-close-differences",
          fetchKeyedExportRows<CashCloseDifferenceRow>(
            reportExportPath("cash-close-differences"),
            // Abierto, la moneda que se ve (Bs por defecto); si no, las dos.
            { currency: cashCloseView ? (cashCloseView.currency ?? "ves") : undefined, from, to },
            (row) => `${row.cashSessionId}|${row.currency}`,
          ),
        )
      : undefined,
    canViewInventory
      ? collector.collect(
          "dead-stock",
          fetchKeyedExportRows<DeadStockRow>(
            reportExportPath("dead-stock"),
            { categoryId: deadStockView?.categoryId, days: deadStockView?.days },
            (row) => row.product.id,
          ),
        )
      : undefined,
    canViewInventory
      ? range
        ? collector.collect(
            "stock-turnover",
            fetchKeyedExportRows<StockTurnoverRow>(
              reportExportPath("stock-turnover"),
              { ...range, groupBy: turnoverView?.turnoverGroupBy },
              (row) => row.key,
            ),
          )
        : []
      : undefined,
    canViewInventory
      ? range
        ? collector.collect(
            "stock-adjustments",
            fetchKeyedExportRows<StockAdjustmentRow>(
              reportExportPath("stock-adjustments"),
              range,
              (row) => row.movementId,
            ),
          )
        : []
      : undefined,
  ]);

  return {
    cashCloseDifferences,
    deadStock,
    payablesAging,
    receivablesAging,
    salesByCategory,
    salesByHour,
    stockAdjustments,
    stockTurnover,
    storeName,
  };
}

/** Misma regla que las rutas de inventario (`assertInventoryReportAccess`). */
function canViewInventoryReports(view: ReportsExportView) {
  try {
    assertInventoryReportAccess({ permissions: view.viewer.permissions });

    return true;
  } catch {
    return false;
  }
}

async function fetchFxDepreciationForExport(
  scope: ReportRequestScope | undefined,
  dateQuery: ExportQuery,
  collector: RowCollector,
) {
  type FxResult = {
    items: FxDepreciationReportRow[];
    summary?: {
      capitalRefToday: number;
      depreciationPctOnVes: number;
      valuationRateVes: number;
      vesLossRef: number;
    };
    total: number;
  };

  // El resumen sale de la primera página; las filas, de la lista completa.
  const first = await apiFetch<FxResult>(reportExportPath("fx-depreciation", scope), {
    query: { ...dateQuery, limit: 100, skip: 0 },
  });
  const rows = await collector.collect(
    "fx-depreciation",
    fetchKeyedExportRows<FxDepreciationReportRow>(
      reportExportPath("fx-depreciation", scope),
      dateQuery,
      (row) => storeKey(row, row.saleId),
    ),
  );
  const summary = first.summary;
  const note = summary
    ? `Tasa valorizacion ${summary.valuationRateVes}; capital hoy REF ${summary.capitalRefToday}; perdida VES REF ${summary.vesLossRef} (${summary.depreciationPctOnVes}%).`
    : undefined;

  return { note, rows };
}

function flattenDailyClose(summary: DailyCloseSummary): DailyCloseExportRow[] {
  return [
    { metric: "Ventas", value: summary.sales.salesCount },
    { metric: "Total REF", value: summary.sales.totalRef },
    { metric: "Total VES", value: summary.sales.totalVes },
    { metric: "Pagos activos", value: summary.paymentsSummary.paymentCount },
    { metric: "Cobros REF", value: summary.paymentsSummary.totalRef },
    { metric: "Perdida FX REF", value: summary.fx.vesLossRef },
    { metric: "Capital REF hoy", value: summary.fx.capitalRefToday },
    {
      metric: "Baul REF",
      value: summary.vault ? summary.vault.balanceRef : "N/D",
    },
    {
      metric: "Caja teorica REF",
      value: summary.cash ? summary.cash.theoreticalOpenRef : "N/D",
    },
  ];
}

async function fetchDailyCloseForExport(
  scope: ReportRequestScope | undefined,
  dateQuery: ExportQuery,
): Promise<DailyCloseExportRow[]> {
  const summary = await apiFetch<DailyCloseSummary>(reportExportPath("daily-close", scope), {
    query: dateQuery,
  });
  return flattenDailyClose(summary);
}
