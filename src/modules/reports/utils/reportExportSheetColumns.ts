import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatDate } from "@/shared/utils/date";

// Mismo formateador que las tablas en pantalla: instante → día operativo de Caracas.
import { formatCaracasDay } from "../reports-list/components/inventory/inventoryReportText";
import {
  AGING_BUCKET_LABELS,
  CASH_CLOSE_CURRENCY_LABELS,
  CASH_CLOSE_REASON_LABELS,
  formatHour,
} from "../reports-list/components/money/moneyReportText";
import type {
  DeadStockRow,
  StockAdjustmentRow,
  StockTurnoverRow,
} from "../services/inventoryReports";
import type {
  AgingDocumentRow,
  CashCloseDifferenceRow,
  SalesByCategoryRow,
} from "../services/moneyReports";
import type {
  CustomerPurchasesReportRow,
  DailySalesReportRow,
  FxDepreciationReportRow,
  GrossProfitReportRow,
  LowStockReportRow,
  PaymentMethodReportRow,
  ProductProfitabilityReportRow,
  PurchasesReportRow,
  StockCardReportRow,
  SupplierPurchasesReportRow,
  TopCustomersReportRow,
  TopProductsReportRow,
} from "../hooks/useReports";

export type ReportExportColumn<T> = {
  /**
   * La columna es un importe o una razón: sus números se escriben siempre con
   * dos decimales. Sin esto son cantidades (sin decimales que no tengan). Una
   * función decide fila a fila (hojas de indicador / valor).
   */
  fixedDecimals?: boolean | ((row: T) => boolean);
  header: string;
  value: (row: T) => string | number;
};

/** Formato de celda de Excel de un importe (dos decimales fijos). */
export const EXCEL_AMOUNT_FORMAT = "#,##0.00";
/** Formato de celda de Excel de una cantidad entera. */
export const EXCEL_INTEGER_FORMAT = "#,##0";

/** ¿Los números de esta columna, en esta fila, van con dos decimales fijos? */
export function hasFixedDecimals<T>(column: ReportExportColumn<T>, row: T) {
  return typeof column.fixedDecimals === "function"
    ? column.fixedDecimals(row)
    : column.fixedDecimals === true;
}

/**
 * Formato de celda de Excel de un número de la exportación: el valor sigue
 * siendo un número y Excel lo pinta con miles y los decimales de su columna.
 */
export function reportExportNumberFormat<T>(column: ReportExportColumn<T>, row: T, value: number) {
  return hasFixedDecimals(column, row) || !Number.isInteger(value)
    ? EXCEL_AMOUNT_FORMAT
    : EXCEL_INTEGER_FORMAT;
}

/**
 * Texto de una celda para el PDF y la vista previa. Único formateador numérico
 * de la exportación (es-VE: «19.125,00»): los importes siempre con dos
 * decimales, sean enteros o no; las cantidades con miles y hasta dos decimales.
 */
export function formatReportExportCell<T>(column: ReportExportColumn<T>, row: T) {
  const value = column.value(row);

  if (typeof value !== "number") {
    return value;
  }

  return value.toLocaleString("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: hasFixedDecimals(column, row) ? 2 : 0,
  });
}

export const dailySalesExportColumns: ReportExportColumn<DailySalesReportRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.saleDate) },
  { header: "Ventas", value: (row) => row.salesCount },
  { fixedDecimals: true, header: "Total REF", value: (row) => row.totalRef },
  { fixedDecimals: true, header: "Total VES", value: (row) => row.totalVes },
  { fixedDecimals: true, header: "Cobrado VES", value: (row) => row.paidVes },
];

export const grossProfitExportColumns: ReportExportColumn<GrossProfitReportRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.saleDate) },
  { fixedDecimals: true, header: "Ingresos REF", value: (row) => row.revenueRef },
  { fixedDecimals: true, header: "Costos REF", value: (row) => row.costRef },
  { fixedDecimals: true, header: "Ganancia REF", value: (row) => row.grossProfitRef },
];

export const productProfitabilityExportColumns: ReportExportColumn<ProductProfitabilityReportRow>[] =
  [
    { header: "Producto", value: (row) => row.name || row.sku },
    { header: "SKU", value: (row) => row.sku },
    { header: "Unidades", value: (row) => row.unitsSold },
    { fixedDecimals: true, header: "Costo REF", value: (row) => row.costRef },
    { fixedDecimals: true, header: "Ganancia REF", value: (row) => row.grossProfitRef },
  ];

export const lowStockExportColumns: ReportExportColumn<LowStockReportRow>[] = [
  { header: "Producto", value: (row) => row.name },
  { header: "SKU", value: (row) => row.sku },
  { header: "Stock", value: (row) => row.currentStock },
  { header: "Mínimo", value: (row) => row.minStock },
];

export const customerPurchasesExportColumns: ReportExportColumn<CustomerPurchasesReportRow>[] =
  [
    { header: "Cliente", value: (row) => row.name },
    { header: "Ventas", value: (row) => row.salesCount },
    { fixedDecimals: true, header: "Total REF", value: (row) => row.totalRef },
    { fixedDecimals: true, header: "Total VES", value: (row) => row.totalVes },
    { fixedDecimals: true, header: "Pendiente VES", value: (row) => row.pendingVes },
    {
      header: "Última compra",
      value: (row) => (row.lastPurchaseAt ? formatCaracasDay(row.lastPurchaseAt) : "Sin compras"),
    },
  ];

export const supplierPurchasesExportColumns: ReportExportColumn<SupplierPurchasesReportRow>[] =
  [
    { header: "Proveedor", value: (row) => row.name },
    { header: "Compras", value: (row) => row.purchasesCount },
    { fixedDecimals: true, header: "Total REF", value: (row) => row.totalRef },
    { fixedDecimals: true, header: "Pendiente VES", value: (row) => row.pendingVes },
    {
      header: "Última compra",
      value: (row) => (row.lastPurchaseAt ? formatCaracasDay(row.lastPurchaseAt) : "Sin compras"),
    },
  ];

export const stockCardExportColumns: ReportExportColumn<StockCardReportRow>[] = [
  { header: "Fecha", value: (row) => formatCaracasDay(row.createdAt) },
  { header: "Producto", value: (row) => row.productName || row.sku || "" },
  { header: "Tipo", value: (row) => row.type },
  { header: "Movimiento", value: (row) => row.quantityDelta },
  { header: "Stock final", value: (row) => row.stockAfter },
];

export const topProductsExportColumns: ReportExportColumn<TopProductsReportRow>[] = [
  { header: "Producto", value: (row) => row.name || row.sku },
  { header: "SKU", value: (row) => row.sku },
  { header: "Unidades", value: (row) => row.unitsSold },
  { fixedDecimals: true, header: "Ingreso REF", value: (row) => row.revenueRef },
];

export const topCustomersExportColumns: ReportExportColumn<TopCustomersReportRow>[] = [
  { header: "Cliente", value: (row) => row.name },
  { header: "Ventas", value: (row) => row.salesCount },
  { fixedDecimals: true, header: "Total REF", value: (row) => row.totalRef },
  { fixedDecimals: true, header: "Total VES", value: (row) => row.totalVes },
];

export const purchasesExportColumns: ReportExportColumn<PurchasesReportRow>[] = [
  { header: "Compra", value: (row) => row.purchaseNumber },
  // Sin nombre no se muestra el id interno del proveedor.
  { header: "Proveedor", value: (row) => row.supplier?.name ?? "Sin proveedor" },
  { header: "Fecha", value: (row) => formatCaracasDay(row.createdAt) },
  { header: "Items", value: (row) => row.itemsCount },
  { fixedDecimals: true, header: "Total VES", value: (row) => row.totalVes },
];

export const fxDepreciationExportColumns: ReportExportColumn<FxDepreciationReportRow>[] = [
  { header: "Factura", value: (row) => row.invoiceNumber },
  { header: "Fecha", value: (row) => formatDate(row.saleDate) },
  { fixedDecimals: true, header: "Tasa venta", value: (row) => row.rateAtSale },
  { fixedDecimals: true, header: "VES cobrado", value: (row) => row.vesCollected },
  { fixedDecimals: true, header: "USD REF", value: (row) => row.usdRef },
  { fixedDecimals: true, header: "REF al cobrar", value: (row) => row.vesRefAtCollection },
  { fixedDecimals: true, header: "REF hoy", value: (row) => row.vesRefToday },
  { fixedDecimals: true, header: "Pérdida REF", value: (row) => row.lossRef },
];

export type DailyCloseExportRow = {
  metric: string;
  value: number | string;
};

export const dailyCloseExportColumns: ReportExportColumn<DailyCloseExportRow>[] = [
  { header: "Indicador", value: (row) => row.metric },
  {
    // Hoja de indicador / valor: son importes los indicadores en REF o VES.
    fixedDecimals: (row) => /\b(REF|VES)\b/.test(row.metric),
    header: "Valor",
    value: (row) => row.value,
  },
];

export const paymentMethodsExportColumns: ReportExportColumn<PaymentMethodReportRow>[] = [
  { header: "Método", value: (row) => paymentMethodLabels[row.method] ?? row.method },
  { header: "Pagos", value: (row) => row.paymentCount },
  { fixedDecimals: true, header: "REF", value: (row) => row.amountRef },
  { fixedDecimals: true, header: "VES", value: (row) => row.amountVes },
];

/** Texto de una medida que no se puede calcular (divisor en cero). */
const NOT_AVAILABLE = "N/D";

function orNotAvailable(value: number | null) {
  return value === null ? NOT_AVAILABLE : value;
}

/** Una celda con ventas de la matriz día de la semana × hora. */
export type SalesByHourExportRow = {
  hour: number;
  salesCount: number;
  totalRef: number;
  totalVes: number;
  /** «lunes» … «domingo». */
  weekday: string;
};

export const salesByHourExportColumns: ReportExportColumn<SalesByHourExportRow>[] = [
  { header: "Día", value: (row) => row.weekday },
  { header: "Hora", value: (row) => formatHour(row.hour) },
  { header: "Ventas", value: (row) => row.salesCount },
  { fixedDecimals: true, header: "Total REF", value: (row) => row.totalRef },
  { fixedDecimals: true, header: "Total VES", value: (row) => row.totalVes },
];

export const salesByCategoryExportColumns: ReportExportColumn<SalesByCategoryRow>[] = [
  { header: "Categoría", value: (row) => row.categoryName },
  { header: "Unidades", value: (row) => row.units },
  { fixedDecimals: true, header: "Ingreso REF", value: (row) => row.revenueRef },
  { fixedDecimals: true, header: "Costo REF", value: (row) => row.costRef },
  { fixedDecimals: true, header: "Ganancia REF", value: (row) => row.grossProfitRef },
  // Mismos nombres que las dos columnas de la pantalla.
  {
    fixedDecimals: true,
    header: "Ganancia sobre costo %",
    value: (row) => orNotAvailable(row.markupPct),
  },
  {
    fixedDecimals: true,
    header: "Margen sobre venta %",
    value: (row) => orNotAvailable(row.marginPct),
  },
];

function agingExportColumns(contactHeader: string): ReportExportColumn<AgingDocumentRow>[] {
  return [
    { header: "Documento", value: (row) => row.document.number },
    { header: contactHeader, value: (row) => row.contact?.name ?? "Sin contacto" },
    { header: "Fecha", value: (row) => formatDate(row.date) },
    { header: "Días", value: (row) => row.days },
    { header: "Tramo", value: (row) => AGING_BUCKET_LABELS[row.bucket] },
    { fixedDecimals: true, header: "Total REF", value: (row) => row.totalRef },
    { fixedDecimals: true, header: "Pagado REF", value: (row) => row.paidRef },
    { fixedDecimals: true, header: "Pendiente REF", value: (row) => row.pendingRef },
    { fixedDecimals: true, header: "Pendiente VES", value: (row) => row.pendingVes },
  ];
}

export const receivablesAgingExportColumns = agingExportColumns("Cliente");

export const payablesAgingExportColumns = agingExportColumns("Proveedor");

export const cashCloseDifferencesExportColumns: ReportExportColumn<CashCloseDifferenceRow>[] = [
  { header: "Fecha de cierre", value: (row) => formatDate(row.closeDate) },
  { header: "Caja", value: (row) => row.registerName ?? "Caja" },
  {
    header: "Cierre",
    value: (row) => (row.closedReason ? CASH_CLOSE_REASON_LABELS[row.closedReason] : NOT_AVAILABLE),
  },
  { header: "Moneda", value: (row) => CASH_CLOSE_CURRENCY_LABELS[row.currency] },
  { fixedDecimals: true, header: "Esperado", value: (row) => row.expected },
  { fixedDecimals: true, header: "Contado", value: (row) => row.counted },
  { fixedDecimals: true, header: "Diferencia", value: (row) => row.difference },
  { fixedDecimals: true, header: "Diferencia acumulada", value: (row) => row.runningDifference },
];

export const deadStockExportColumns: ReportExportColumn<DeadStockRow>[] = [
  { header: "Producto", value: (row) => row.product.name || row.product.sku },
  { header: "SKU", value: (row) => row.product.sku },
  { header: "Categoría", value: (row) => row.category.name },
  { header: "Stock", value: (row) => row.stock },
  { fixedDecimals: true, header: "Costo REF", value: (row) => row.costRef },
  { fixedDecimals: true, header: "Valor inmovilizado REF", value: (row) => row.stockValueRef },
  { header: "Días sin vender", value: (row) => row.daysIdle },
  {
    header: "Última venta",
    value: (row) => (row.lastSaleAt ? formatCaracasDay(row.lastSaleAt) : "Nunca"),
  },
];

export const stockTurnoverExportColumns: ReportExportColumn<StockTurnoverRow>[] = [
  // Por categoría la fila no tiene producto: se nombra con la categoría.
  { header: "Nombre", value: (row) => row.product?.name || row.product?.sku || row.category.name },
  { header: "SKU", value: (row) => row.product?.sku ?? "" },
  { header: "Categoría", value: (row) => row.category.name },
  { header: "Unidades vendidas", value: (row) => row.soldUnits },
  { fixedDecimals: true, header: "Costo de lo vendido REF", value: (row) => row.cogsRef },
  { fixedDecimals: true, header: "Inventario promedio REF", value: (row) => row.averageStockValueRef },
  { fixedDecimals: true, header: "Rotación", value: (row) => orNotAvailable(row.turnover) },
  { header: "Días de inventario", value: (row) => orNotAvailable(row.daysOfInventory) },
  { header: "Stock", value: (row) => row.stock },
  { fixedDecimals: true, header: "Valor del stock REF", value: (row) => row.stockValueRef },
];

export const stockAdjustmentsExportColumns: ReportExportColumn<StockAdjustmentRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.date) },
  { header: "Producto", value: (row) => row.product.name || row.product.sku },
  { header: "SKU", value: (row) => row.product.sku },
  { header: "Tipo", value: (row) => (row.type === "ajuste_entrada" ? "Entrada" : "Salida") },
  { header: "Motivo", value: (row) => row.reason },
  { header: "Cantidad", value: (row) => row.quantityDelta },
  { fixedDecimals: true, header: "Costo unitario REF", value: (row) => row.unitCostRef },
  { fixedDecimals: true, header: "Valor REF", value: (row) => row.valueRef },
];
