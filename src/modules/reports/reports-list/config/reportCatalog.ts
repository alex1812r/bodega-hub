import {
  ClipboardCheck,
  LineChart,
  Package,
  PackageMinus,
  PieChart,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Truck,
  Trophy,
  UserRoundCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export const REPORT_IDS = [
  "daily-sales",
  "gross-profit",
  "product-profitability",
  "top-products",
  "top-customers",
  "customer-purchases",
  "purchases",
  "supplier-purchases",
  "low-stock",
  "stock-card",
  "daily-close",
  "payment-methods",
  "fx-depreciation",
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

/**
 * Gráfico que el reporte lleva encima de la tabla (un solo componente por tipo):
 * `line` = serie en el tiempo (`TimeSeriesChart`); `ranking` = barras
 * horizontales ordenadas (`RankingBarChart`). Sin él, el reporte es solo tabla.
 */
export type ReportChartKind = "line" | "ranking";

/** Rango que usan los reportes con gráfico y fechas cuando la URL no trae ninguno. */
export const REPORT_DEFAULT_DATE_PRESET = "last_30_days";

export type ReportGroupId = "ventas" | "compras" | "inventario" | "dinero";

/** Grupos del catálogo, en el orden en que se muestran. */
export const reportGroups: readonly { id: ReportGroupId; label: string }[] = [
  { id: "ventas", label: "Ventas" },
  { id: "compras", label: "Compras" },
  { id: "inventario", label: "Inventario" },
  { id: "dinero", label: "Dinero" },
];

/**
 * Un reporte del catálogo. Añadir un reporte = sumar su id a `REPORT_IDS`, una
 * entrada aquí y su `case` en `ReportsResultPanel`: el catálogo, la URL
 * (`?report=`) y la barra de filtros se adaptan solos a estos campos.
 */
export type ReportDefinition = {
  /** Gráfico encima de la tabla; ver `ReportChartKind`. */
  chart?: ReportChartKind;
  /**
   * Rango por defecto cuando la URL no trae `from`, `to` ni `preset`. Se
   * calcula con el hoy operativo y no se escribe en la URL.
   */
  defaultDatePreset?: typeof REPORT_DEFAULT_DATE_PRESET;
  /** Una sola línea. */
  description: string;
  /** Filtro de entidad que usa el reporte, además del rango. */
  entityFilter?: "product" | "supplier";
  group: ReportGroupId;
  icon: LucideIcon;
  id: ReportId;
  name: string;
  period: string;
  /** Admite «Comparar con periodo anterior» (`compare=1`). */
  supportsCompare?: boolean;
  /** Reporte de serie: admite agrupar por día, semana o mes (`groupBy`). */
  supportsGroupBy?: boolean;
  /** `false` = foto actual o histórico completo: el rango de fechas no aplica. */
  usesDateRange: boolean;
};

export const reportCatalog: ReportDefinition[] = [
  {
    id: "daily-sales",
    chart: "line",
    defaultDatePreset: REPORT_DEFAULT_DATE_PRESET,
    group: "ventas",
    icon: LineChart,
    name: "Ventas diarias",
    period: "Rango",
    description: "Ventas por día: cantidad, total y cobrado.",
    supportsCompare: true,
    supportsGroupBy: true,
    usesDateRange: true,
  },
  {
    id: "gross-profit",
    chart: "line",
    defaultDatePreset: REPORT_DEFAULT_DATE_PRESET,
    group: "ventas",
    icon: TrendingUp,
    name: "Ganancia bruta",
    period: "Rango",
    description: "Ingresos, costos y ganancia bruta por venta.",
    supportsCompare: true,
    supportsGroupBy: true,
    usesDateRange: true,
  },
  {
    id: "product-profitability",
    chart: "ranking",
    group: "ventas",
    icon: PieChart,
    name: "Rentabilidad por producto",
    period: "Histórico",
    description: "Unidades vendidas, costo y ganancia por producto.",
    usesDateRange: false,
  },
  {
    id: "top-products",
    chart: "ranking",
    defaultDatePreset: REPORT_DEFAULT_DATE_PRESET,
    group: "ventas",
    icon: Trophy,
    name: "Top productos",
    period: "Rango",
    description: "Productos más vendidos en el rango elegido.",
    usesDateRange: true,
  },
  {
    id: "top-customers",
    chart: "ranking",
    defaultDatePreset: REPORT_DEFAULT_DATE_PRESET,
    group: "ventas",
    icon: UserRoundCheck,
    name: "Top clientes",
    period: "Rango",
    description: "Clientes que más compraron en el rango elegido.",
    usesDateRange: true,
  },
  {
    id: "customer-purchases",
    chart: "ranking",
    group: "ventas",
    icon: Users,
    name: "Compras de clientes",
    period: "Histórico",
    description: "Ventas acumuladas, deuda y última compra por cliente.",
    usesDateRange: false,
  },
  {
    id: "purchases",
    chart: "line",
    defaultDatePreset: REPORT_DEFAULT_DATE_PRESET,
    group: "compras",
    icon: ShoppingCart,
    name: "Compras",
    period: "Rango",
    description: "Compras del rango, con filtro por proveedor.",
    entityFilter: "supplier",
    supportsCompare: true,
    supportsGroupBy: true,
    usesDateRange: true,
  },
  {
    id: "supplier-purchases",
    chart: "ranking",
    group: "compras",
    icon: Truck,
    name: "Compras a proveedores",
    period: "Histórico",
    description: "Compras acumuladas, deuda y última compra por proveedor.",
    usesDateRange: false,
  },
  {
    id: "low-stock",
    group: "inventario",
    icon: PackageMinus,
    name: "Bajo stock",
    period: "Actual",
    description: "Productos con stock por debajo del mínimo.",
    usesDateRange: false,
  },
  {
    id: "stock-card",
    group: "inventario",
    icon: Package,
    name: "Kardex de producto",
    period: "Histórico",
    description: "Entradas y salidas de inventario de un producto.",
    entityFilter: "product",
    usesDateRange: false,
  },
  {
    id: "daily-close",
    group: "dinero",
    icon: ClipboardCheck,
    name: "Cierre del día",
    period: "Día operativo",
    description: "Ventas, cobros por método, pérdida cambiaria y estado de caja y baúl.",
    usesDateRange: true,
  },
  {
    id: "payment-methods",
    chart: "ranking",
    defaultDatePreset: REPORT_DEFAULT_DATE_PRESET,
    group: "dinero",
    icon: Wallet,
    name: "Métodos de pago",
    period: "Rango",
    description: "Cobros de ventas por método: cantidad, REF y Bs.",
    supportsCompare: true,
    usesDateRange: true,
  },
  {
    id: "fx-depreciation",
    group: "dinero",
    icon: TrendingDown,
    name: "Depreciación FX",
    period: "Al generar",
    description: "Cuánto vale hoy en REF lo cobrado en bolívares.",
    usesDateRange: true,
  },
];

export const defaultReportId: ReportId = "daily-sales";

export function isReportId(value: unknown): value is ReportId {
  return typeof value === "string" && (REPORT_IDS as readonly string[]).includes(value);
}

export function getReportById(id: ReportId) {
  return reportCatalog.find((report) => report.id === id) ?? reportCatalog[0];
}

/** Minúsculas y sin tildes, para comparar lo tecleado con el catálogo. */
function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Reportes cuyo nombre o descripción contiene el texto (sin tildes ni mayúsculas). */
export function searchReports(reports: readonly ReportDefinition[], search: string) {
  const term = normalizeSearchText(search);

  if (term === "") {
    return [...reports];
  }

  return reports.filter((report) =>
    normalizeSearchText(`${report.name} ${report.description}`).includes(term),
  );
}

/** Reportes repartidos en sus grupos, en el orden del catálogo; sin grupos vacíos. */
export function groupReports(reports: readonly ReportDefinition[]) {
  return reportGroups
    .map((group) => ({ ...group, reports: reports.filter((report) => report.group === group.id) }))
    .filter((group) => group.reports.length > 0);
}
