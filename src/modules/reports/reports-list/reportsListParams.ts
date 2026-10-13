import { z } from "zod";

import {
  DATE_RANGE_PRESETS,
  parseDateRangeParams,
  resolveDateRangePreset,
  serializeDateRange,
  type DateRangeChange,
  type DateRangeParams,
  type DateRangeValue,
} from "@/shared/components/DateRangeField";
import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type {
  PurchasesReportFilters,
  ReportDateRangeFilters,
  StockCardReportFilters,
} from "../hooks/useReports";
import {
  DEAD_STOCK_DEFAULT_DAYS,
  DEAD_STOCK_MAX_DAYS,
  STOCK_TURNOVER_GROUP_BY_VALUES,
  type StockTurnoverGroupBy,
} from "../services/inventoryReports";
import {
  AGING_BUCKETS,
  CASH_CLOSE_CURRENCIES,
  type AgingBucket,
  type CashCloseCurrency,
} from "../services/moneyReports";
import {
  PURCHASE_REPORT_STATUS_ALL,
  PURCHASE_REPORT_STATUSES,
  REPORT_GROUP_BY_VALUES,
} from "../services/reportSeries";
import { defaultReportId, isReportId, type ReportDefinition, type ReportId } from "./config/reportCatalog";

/** Mismo tope que acepta el servidor para `contactId` (`parseAgingQuery`). */
const CONTACT_ID_MAX_LENGTH = 120;

/** Mismo tope que acepta el servidor para `categoryId` (`parseDeadStockQuery`). */
const CATEGORY_ID_MAX_LENGTH = 120;

/** Agrupación de «Rotación de inventario» cuando la URL no trae `turnoverBy`. */
export const DEFAULT_TURNOVER_BY: StockTurnoverGroupBy = "product";

/** Reporte activo: un id del catálogo; cualquier otro valor cae al reporte por defecto. */
const reportParam = () => z.custom<ReportId>(isReportId).default(defaultReportId);

/**
 * Estado de `/reports` en la URL (regla 15). Sin parámetros = reporte por
 * defecto, rango por defecto del reporte, agrupación automática, sin comparar,
 * página 1.
 *
 * | Parámetro    | Valores                                             | Por defecto         |
 * |--------------|-----------------------------------------------------|---------------------|
 * | `report`     | id del catálogo                                     | `daily-sales`       |
 * | `from`, `to` | día de Caracas `YYYY-MM-DD`, inclusive              | `""` (ver abajo)    |
 * | `preset`     | preset de `DateRangeField` (relativo: se recalcula) | `""` (ver abajo)    |
 * | `groupBy`    | `day` · `week` · `month`                            | `""` = automática   |
 * | `compare`    | `1`                                                 | `""` = sin comparar |
 * | `supplierId` | id de proveedor (reporte de compras)                | `""`                |
 * | `productId`  | id de producto (kardex)                             | `""`                |
 * | `bucket`     | `0-7` · `8-30` · `30+` (cuentas por cobrar / pagar) | `""` = todos        |
 * | `contactId`  | id de contacto (cuentas por cobrar / pagar)         | `""`                |
 * | `currency`   | `ves` · `ref` (diferencias de cierre de caja)       | `""` = `ves`        |
 * | `status`     | `all` o un estado de compra (reporte de compras)    | `""` = vigentes     |
 * | `days`       | entero 1–3650 (productos sin movimiento)            | `30`                |
 * | `categoryId` | id de categoría (productos sin movimiento)          | `""`                |
 * | `turnoverBy` | `product` · `category` (rotación de inventario)     | `product`           |
 * | `page`       | base 1, de la tabla del reporte activo              | `1`                 |
 * | `limit`      | tamaño de página                                    | `10`                |
 *
 * Sin `from`, `to` ni `preset`, el rango es el de por defecto del reporte
 * activo (`defaultDatePreset` del catálogo): últimos 30 días en los reportes con
 * gráfico y fechas; sin rango en cierre del día y depreciación FX. Ese rango no
 * se escribe en la URL. `preset=custom` sin fechas es «todas las fechas»
 * elegido a propósito (ver `serializeReportsRange`).
 *
 * `status` ausente = compras vigentes (todas menos canceladas y devueltas).
 * `turnoverBy` es propio de la rotación: `groupBy` ya significa día, semana o
 * mes en esta pantalla y no se reutiliza con otro sentido.
 *
 * Cambiar cualquier parámetro (también `report`) devuelve `page` a 1. Cambiar
 * de reporte limpia además `bucket`, `contactId`, `currency`, `status`,
 * `days`, `categoryId` y `turnoverBy` (`toReportSwitchPatch`): un cliente no
 * vale como filtro de cuentas por pagar.
 */
export const reportsListSchema = z.object({
  report: reportParam(),
  from: listParams.date(),
  to: listParams.date(),
  preset: listParams.oneOf(["", ...DATE_RANGE_PRESETS], ""),
  groupBy: listParams.oneOf(["", ...REPORT_GROUP_BY_VALUES], ""),
  compare: listParams.oneOf(["", "1"], ""),
  supplierId: listParams.text(64),
  productId: listParams.text(64),
  bucket: listParams.oneOf(["", ...AGING_BUCKETS], ""),
  contactId: listParams.text(CONTACT_ID_MAX_LENGTH),
  currency: listParams.oneOf(["", ...CASH_CLOSE_CURRENCIES], ""),
  status: listParams.oneOf(["", PURCHASE_REPORT_STATUS_ALL, ...PURCHASE_REPORT_STATUSES], ""),
  days: z.number().int().min(1).max(DEAD_STOCK_MAX_DAYS).default(DEAD_STOCK_DEFAULT_DAYS),
  categoryId: listParams.text(CATEGORY_ID_MAX_LENGTH),
  turnoverBy: listParams.oneOf(STOCK_TURNOVER_GROUP_BY_VALUES, DEFAULT_TURNOVER_BY),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type ReportsListState = UrlListStateOf<typeof reportsListSchema.shape>;

/** Moneda de «Diferencias de cierre de caja» cuando la URL no trae `currency`. */
export const DEFAULT_CASH_CLOSE_CURRENCY: CashCloseCurrency = "ves";

/** Filtros propios de los reportes de dinero de REP-06, ya tipados. */
export type MoneyReportFilters = {
  /** Tramo de antigüedad; sin él, todos. */
  bucket?: AgingBucket;
  contactId?: string;
  currency: CashCloseCurrency;
};

type MoneyReportParams = Pick<ReportsListState, "bucket" | "contactId" | "currency">;

/** Estado de la URL → filtros de los reportes de dinero. */
export function toMoneyReportFilters(state: MoneyReportParams): MoneyReportFilters {
  return {
    bucket: state.bucket || undefined,
    contactId: state.contactId || undefined,
    currency: state.currency || DEFAULT_CASH_CLOSE_CURRENCY,
  };
}

/**
 * Cambio de filtros de dinero → patch de la URL. Solo toca las claves que trae
 * el cambio; la moneda por defecto no se escribe.
 */
export function serializeMoneyReportFilters(patch: Partial<MoneyReportFilters>): Partial<MoneyReportParams> {
  const params: Partial<MoneyReportParams> = {};

  if ("bucket" in patch) {
    params.bucket = patch.bucket ?? "";
  }

  if ("contactId" in patch) {
    params.contactId = patch.contactId ?? "";
  }

  if ("currency" in patch) {
    params.currency =
      patch.currency && patch.currency !== DEFAULT_CASH_CLOSE_CURRENCY ? patch.currency : "";
  }

  return params;
}

/** Filtros propios de los reportes de inventario de REP-07, ya tipados. */
export type InventoryReportFilters = {
  /** Categoría de «Productos sin movimiento»; sin ella, todas. */
  categoryId?: string;
  /** Días sin vender de «Productos sin movimiento» (1–3650). */
  days: number;
  /** «Rotación de inventario» por producto o por categoría. */
  turnoverBy: StockTurnoverGroupBy;
};

type InventoryReportParams = Pick<ReportsListState, "categoryId" | "days" | "turnoverBy">;

/** Estado de la URL → filtros de los reportes de inventario. */
export function toInventoryReportFilters(state: InventoryReportParams): InventoryReportFilters {
  return {
    categoryId: state.categoryId || undefined,
    days: state.days,
    turnoverBy: state.turnoverBy,
  };
}

/**
 * Cambio de filtros de inventario → patch de la URL. Solo toca las claves que
 * trae el cambio. Los valores por defecto (30 días, por producto) no llegan a
 * escribirse: `useUrlListState` omite lo que coincide con el valor por defecto.
 */
export function serializeInventoryReportFilters(
  patch: Partial<InventoryReportFilters>,
): Partial<InventoryReportParams> {
  const params: Partial<InventoryReportParams> = {};

  if ("categoryId" in patch) {
    params.categoryId = patch.categoryId ?? "";
  }

  if ("days" in patch) {
    params.days = patch.days ?? DEAD_STOCK_DEFAULT_DAYS;
  }

  if ("turnoverBy" in patch) {
    params.turnoverBy = patch.turnoverBy ?? DEFAULT_TURNOVER_BY;
  }

  return params;
}

/**
 * Patch de la URL al elegir otro reporte: los filtros de dinero, el estado de
 * compras y los filtros de inventario no se arrastran.
 */
export function toReportSwitchPatch(
  report: ReportId,
): Pick<ReportsListState, "report" | "status"> & InventoryReportParams & MoneyReportParams {
  return {
    bucket: "",
    categoryId: "",
    contactId: "",
    currency: "",
    days: DEAD_STOCK_DEFAULT_DAYS,
    report,
    status: "",
    turnoverBy: DEFAULT_TURNOVER_BY,
  };
}

export type ReportsListFilters = {
  dateFilters: ReportDateRangeFilters;
  purchasesFilters: PurchasesReportFilters;
  stockCardFilters: StockCardReportFilters;
};

/**
 * Estado de la URL + rango ya resuelto (`parseDateRangeParams`) → filtros de los
 * reportes y de la exportación. `groupBy` y `compare` viajan en `dateFilters`;
 * `ReportsResultPanel` los pasa solo a los reportes que los admiten. `status`
 * (compras) solo viaja si la URL lo trae: sin él, el servicio excluye
 * canceladas y devueltas.
 */
export function toReportsFilters(
  state: Pick<ReportsListState, "compare" | "groupBy" | "productId" | "status" | "supplierId">,
  range: Pick<DateRangeChange, "from" | "to">,
): ReportsListFilters {
  const dateRange = { from: range.from, to: range.to };

  return {
    dateFilters: {
      ...dateRange,
      compare: state.compare === "1" ? true : undefined,
      groupBy: state.groupBy || undefined,
    },
    purchasesFilters: {
      ...dateRange,
      ...(state.status ? { status: state.status } : {}),
      supplierId: state.supplierId || undefined,
    },
    stockCardFilters: { productId: state.productId || undefined },
  };
}

/**
 * Rango efectivo: el de la URL (un `preset` relativo se recalcula con el hoy
 * operativo) o, si la URL no trae `from`, `to` ni `preset`, el rango por
 * defecto del reporte. Sin `report` no hay rango por defecto.
 */
export function resolveReportsRange(
  state: Pick<ReportsListState, "from" | "preset" | "to">,
  today: string,
  report?: Pick<ReportDefinition, "defaultDatePreset">,
): DateRangeChange {
  const hasRangeParams = state.from !== "" || state.to !== "" || state.preset !== "";

  if (!hasRangeParams && report?.defaultDatePreset) {
    return {
      ...resolveDateRangePreset(report.defaultDatePreset, today),
      preset: report.defaultDatePreset,
    };
  }

  return parseDateRangeParams(state, today);
}

/**
 * Rango elegido → patch de `from` / `to` / `preset` para la URL. Igual que
 * `serializeDateRange`, salvo al quitar el rango en un reporte con rango por
 * defecto: ahí «sin parámetros» significa ese rango, así que «todas las
 * fechas» se guarda como `preset=custom` sin fechas.
 */
export function serializeReportsRange(
  next: DateRangeValue,
  report?: Pick<ReportDefinition, "defaultDatePreset">,
): DateRangeParams {
  const params = serializeDateRange(next);
  const isCleared = params.from === "" && params.to === "" && params.preset === "";

  return isCleared && report?.defaultDatePreset ? { ...params, preset: "custom" } : params;
}

/** Parámetros de fecha que un reporte admite, a partir de los filtros globales. */
export function toReportDateFilters(
  report: Pick<ReportDefinition, "supportsCompare" | "supportsGroupBy" | "usesDateRange">,
  filters: ReportDateRangeFilters,
): ReportDateRangeFilters {
  if (!report.usesDateRange) {
    return {};
  }

  const range: ReportDateRangeFilters = { from: filters.from, to: filters.to };
  // El servidor solo calcula la serie o el periodo anterior con el rango completo.
  const hasFullRange = Boolean(filters.from && filters.to);

  if (!hasFullRange) {
    return range;
  }

  if (report.supportsGroupBy) {
    // Sin `groupBy` en la URL se pide la agrupación automática: la serie llega siempre.
    range.groupBy = filters.groupBy ?? "auto";
  }

  if (report.supportsCompare && filters.compare) {
    range.compare = true;
  }

  return range;
}
