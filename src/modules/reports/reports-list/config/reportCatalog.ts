import {
  LineChart,
  Package,
  PackageMinus,
  PieChart,
  ShoppingCart,
  TrendingUp,
  Truck,
  Trophy,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ReportId =
  | "customer-purchases"
  | "daily-sales"
  | "gross-profit"
  | "low-stock"
  | "product-profitability"
  | "purchases"
  | "stock-card"
  | "supplier-purchases"
  | "top-customers"
  | "top-products";

export type ReportDefinition = {
  description: string;
  icon: LucideIcon;
  id: ReportId;
  ignoresGlobalFilters?: boolean;
  name: string;
  period: string;
};

export const reportCatalog: ReportDefinition[] = [
  {
    id: "daily-sales",
    icon: LineChart,
    ignoresGlobalFilters: true,
    name: "Ventas diarias",
    period: "Diario / Mensual",
    description: "Resumen de transacciones de venta consolidadas por dia.",
  },
  {
    id: "gross-profit",
    icon: TrendingUp,
    name: "Ganancia bruta",
    period: "Diario",
    description: "Ingresos, costos y utilidad bruta por venta.",
  },
  {
    id: "product-profitability",
    icon: PieChart,
    name: "Rentabilidad por producto",
    period: "Mensual",
    description: "Unidades vendidas, costo y utilidad por SKU.",
  },
  {
    id: "low-stock",
    icon: PackageMinus,
    name: "Bajo stock",
    period: "Actual",
    description: "Productos con stock actual por debajo del minimo.",
  },
  {
    id: "customer-purchases",
    icon: Users,
    name: "Compras de clientes",
    period: "Historico",
    description: "Ventas acumuladas, deuda y ultima compra por cliente.",
  },
  {
    id: "supplier-purchases",
    icon: Truck,
    name: "Compras a proveedores",
    period: "Historico",
    description: "Compras acumuladas, deuda y ultimo movimiento por proveedor.",
  },
  {
    id: "stock-card",
    icon: Package,
    name: "Kardex de producto",
    period: "Historico",
    description: "Movimientos de entrada y salida de inventario.",
  },
  {
    id: "top-products",
    icon: Trophy,
    name: "Top productos",
    period: "Rango",
    description: "Productos mas vendidos dentro del rango seleccionado.",
  },
  {
    id: "top-customers",
    icon: UserRoundCheck,
    name: "Top clientes",
    period: "Rango",
    description: "Clientes con mayor compra dentro del rango seleccionado.",
  },
  {
    id: "purchases",
    icon: ShoppingCart,
    name: "Compras",
    period: "Rango",
    description: "Compras por rango y proveedor.",
  },
];

export const defaultReportId: ReportId = "daily-sales";

export function getReportById(id: ReportId) {
  return reportCatalog.find((report) => report.id === id) ?? reportCatalog[0];
}
