import type { StockMovementMock } from "@/shared/mocks/erp-data";
import { formatDate } from "@/shared/utils/date";

import type {
  CustomerPurchasesReportRow,
  DailySalesReportRow,
  GrossProfitReportRow,
  LowStockReportRow,
  ProductProfitabilityReportRow,
  PurchasesReportRow,
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
    { header: "Producto", value: (row) => row.productId },
    { header: "SKU", value: (row) => row.sku },
    { header: "Unidades", value: (row) => row.unitsSold },
    { header: "Costo REF", value: (row) => row.costRef },
    { header: "Ganancia REF", value: (row) => row.grossProfitRef },
  ];

export const lowStockExportColumns: ReportExportColumn<LowStockReportRow>[] = [
  { header: "Producto", value: (row) => row.name },
  { header: "SKU", value: (row) => row.sku },
  { header: "Stock", value: (row) => row.currentStock },
  { header: "Minimo", value: (row) => row.minStock },
];

export const customerPurchasesExportColumns: ReportExportColumn<CustomerPurchasesReportRow>[] =
  [
    { header: "Cliente", value: (row) => row.name },
    { header: "Ventas", value: (row) => row.salesCount },
    { header: "Total REF", value: (row) => row.totalRef },
    { header: "Total VES", value: (row) => row.totalVes },
    { header: "Pendiente VES", value: (row) => row.pendingVes },
    {
      header: "Ultima compra",
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
      header: "Ultima compra",
      value: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : "Sin compras"),
    },
  ];

export const stockCardExportColumns: ReportExportColumn<StockMovementMock>[] = [
  { header: "Fecha", value: (row) => formatDate(row.createdAt) },
  { header: "Producto", value: (row) => row.productId },
  { header: "Tipo", value: (row) => row.type },
  { header: "Movimiento", value: (row) => row.quantityDelta },
  { header: "Stock final", value: (row) => row.stockAfter },
];

export const topProductsExportColumns: ReportExportColumn<TopProductsReportRow>[] = [
  { header: "Producto", value: (row) => row.productId },
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
  { header: "Proveedor", value: (row) => row.supplier?.name ?? row.supplierId },
  { header: "Fecha", value: (row) => formatDate(row.createdAt) },
  { header: "Items", value: (row) => row.itemsCount },
  { header: "Total VES", value: (row) => row.totalVes },
];
