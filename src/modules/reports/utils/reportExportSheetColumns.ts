import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatDate } from "@/shared/utils/date";

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
  header: string;
  value: (row: T) => string | number;
};

export const dailySalesExportColumns: ReportExportColumn<DailySalesReportRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.saleDate) },
  { header: "Ventas", value: (row) => row.salesCount },
  { header: "Total REF", value: (row) => row.totalRef },
  { header: "Total VES", value: (row) => row.totalVes },
  { header: "Cobrado VES", value: (row) => row.paidVes },
];

export const grossProfitExportColumns: ReportExportColumn<GrossProfitReportRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.saleDate) },
  { header: "Ingresos REF", value: (row) => row.revenueRef },
  { header: "Costos REF", value: (row) => row.costRef },
  { header: "Ganancia REF", value: (row) => row.grossProfitRef },
];

export const productProfitabilityExportColumns: ReportExportColumn<ProductProfitabilityReportRow>[] =
  [
    { header: "Producto", value: (row) => row.name || row.sku },
    { header: "SKU", value: (row) => row.sku },
    { header: "Unidades", value: (row) => row.unitsSold },
    { header: "Costo REF", value: (row) => row.costRef },
    { header: "Ganancia REF", value: (row) => row.grossProfitRef },
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
    { header: "Total REF", value: (row) => row.totalRef },
    { header: "Total VES", value: (row) => row.totalVes },
    { header: "Pendiente VES", value: (row) => row.pendingVes },
    {
      header: "Última compra",
      value: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras"),
    },
  ];

export const supplierPurchasesExportColumns: ReportExportColumn<SupplierPurchasesReportRow>[] =
  [
    { header: "Proveedor", value: (row) => row.name },
    { header: "Compras", value: (row) => row.purchasesCount },
    { header: "Total REF", value: (row) => row.totalRef },
    { header: "Pendiente VES", value: (row) => row.pendingVes },
    {
      header: "Última compra",
      value: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras"),
    },
  ];

export const stockCardExportColumns: ReportExportColumn<StockCardReportRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.createdAt) },
  { header: "Producto", value: (row) => row.productName || row.sku || "" },
  { header: "Tipo", value: (row) => row.type },
  { header: "Movimiento", value: (row) => row.quantityDelta },
  { header: "Stock final", value: (row) => row.stockAfter },
];

export const topProductsExportColumns: ReportExportColumn<TopProductsReportRow>[] = [
  { header: "Producto", value: (row) => row.name || row.sku },
  { header: "SKU", value: (row) => row.sku },
  { header: "Unidades", value: (row) => row.unitsSold },
  { header: "Ingreso REF", value: (row) => row.revenueRef },
];

export const topCustomersExportColumns: ReportExportColumn<TopCustomersReportRow>[] = [
  { header: "Cliente", value: (row) => row.name },
  { header: "Ventas", value: (row) => row.salesCount },
  { header: "Total REF", value: (row) => row.totalRef },
  { header: "Total VES", value: (row) => row.totalVes },
];

export const purchasesExportColumns: ReportExportColumn<PurchasesReportRow>[] = [
  { header: "Compra", value: (row) => row.purchaseNumber },
  // Sin nombre no se muestra el id interno del proveedor.
  { header: "Proveedor", value: (row) => row.supplier?.name ?? "Sin proveedor" },
  { header: "Fecha", value: (row) => formatDate(row.createdAt) },
  { header: "Items", value: (row) => row.itemsCount },
  { header: "Total VES", value: (row) => row.totalVes },
];

export const fxDepreciationExportColumns: ReportExportColumn<FxDepreciationReportRow>[] = [
  { header: "Factura", value: (row) => row.invoiceNumber },
  { header: "Fecha", value: (row) => formatDate(row.saleDate) },
  { header: "Tasa venta", value: (row) => row.rateAtSale },
  { header: "VES cobrado", value: (row) => row.vesCollected },
  { header: "USD REF", value: (row) => row.usdRef },
  { header: "REF al cobrar", value: (row) => row.vesRefAtCollection },
  { header: "REF hoy", value: (row) => row.vesRefToday },
  { header: "Pérdida REF", value: (row) => row.lossRef },
];

export type DailyCloseExportRow = {
  metric: string;
  value: number | string;
};

export const dailyCloseExportColumns: ReportExportColumn<DailyCloseExportRow>[] = [
  { header: "Indicador", value: (row) => row.metric },
  { header: "Valor", value: (row) => row.value },
];

export const paymentMethodsExportColumns: ReportExportColumn<PaymentMethodReportRow>[] = [
  { header: "Método", value: (row) => paymentMethodLabels[row.method] ?? row.method },
  { header: "Pagos", value: (row) => row.paymentCount },
  { header: "REF", value: (row) => row.amountRef },
  { header: "VES", value: (row) => row.amountVes },
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
  { header: "Total REF", value: (row) => row.totalRef },
  { header: "Total VES", value: (row) => row.totalVes },
];

export const salesByCategoryExportColumns: ReportExportColumn<SalesByCategoryRow>[] = [
  { header: "Categoría", value: (row) => row.categoryName },
  { header: "Unidades", value: (row) => row.units },
  { header: "Ingreso REF", value: (row) => row.revenueRef },
  { header: "Costo REF", value: (row) => row.costRef },
  { header: "Ganancia REF", value: (row) => row.grossProfitRef },
  { header: "Margen %", value: (row) => orNotAvailable(row.marginPct) },
];

function agingExportColumns(contactHeader: string): ReportExportColumn<AgingDocumentRow>[] {
  return [
    { header: "Documento", value: (row) => row.document.number },
    { header: contactHeader, value: (row) => row.contact?.name ?? "Sin contacto" },
    { header: "Fecha", value: (row) => formatDate(row.date) },
    { header: "Días", value: (row) => row.days },
    { header: "Tramo", value: (row) => AGING_BUCKET_LABELS[row.bucket] },
    { header: "Total REF", value: (row) => row.totalRef },
    { header: "Pagado REF", value: (row) => row.paidRef },
    { header: "Pendiente REF", value: (row) => row.pendingRef },
    { header: "Pendiente VES", value: (row) => row.pendingVes },
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
  { header: "Esperado", value: (row) => row.expected },
  { header: "Contado", value: (row) => row.counted },
  { header: "Diferencia", value: (row) => row.difference },
  { header: "Diferencia acumulada", value: (row) => row.runningDifference },
];

export const deadStockExportColumns: ReportExportColumn<DeadStockRow>[] = [
  { header: "Producto", value: (row) => row.product.name || row.product.sku },
  { header: "SKU", value: (row) => row.product.sku },
  { header: "Categoría", value: (row) => row.category.name },
  { header: "Stock", value: (row) => row.stock },
  { header: "Costo REF", value: (row) => row.costRef },
  { header: "Valor inmovilizado REF", value: (row) => row.stockValueRef },
  { header: "Días sin vender", value: (row) => row.daysIdle },
  {
    header: "Última venta",
    value: (row) => (row.lastSaleAt ? formatDate(row.lastSaleAt) : "Nunca"),
  },
];

export const stockTurnoverExportColumns: ReportExportColumn<StockTurnoverRow>[] = [
  // Por categoría la fila no tiene producto: se nombra con la categoría.
  { header: "Nombre", value: (row) => row.product?.name || row.product?.sku || row.category.name },
  { header: "SKU", value: (row) => row.product?.sku ?? "" },
  { header: "Categoría", value: (row) => row.category.name },
  { header: "Unidades vendidas", value: (row) => row.soldUnits },
  { header: "Costo de lo vendido REF", value: (row) => row.cogsRef },
  { header: "Inventario promedio REF", value: (row) => row.averageStockValueRef },
  { header: "Rotación", value: (row) => orNotAvailable(row.turnover) },
  { header: "Días de inventario", value: (row) => orNotAvailable(row.daysOfInventory) },
  { header: "Stock", value: (row) => row.stock },
  { header: "Valor del stock REF", value: (row) => row.stockValueRef },
];

export const stockAdjustmentsExportColumns: ReportExportColumn<StockAdjustmentRow>[] = [
  { header: "Fecha", value: (row) => formatDate(row.date) },
  { header: "Producto", value: (row) => row.product.name || row.product.sku },
  { header: "SKU", value: (row) => row.product.sku },
  { header: "Tipo", value: (row) => (row.type === "ajuste_entrada" ? "Entrada" : "Salida") },
  { header: "Motivo", value: (row) => row.reason },
  { header: "Cantidad", value: (row) => row.quantityDelta },
  { header: "Costo unitario REF", value: (row) => row.unitCostRef },
  { header: "Valor REF", value: (row) => row.valueRef },
];
