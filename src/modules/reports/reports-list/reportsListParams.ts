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
  AGING_BUCKETS,
  CASH_CLOSE_CURRENCIES,
  type AgingBucket,
  type CashCloseCurrency,
} from "../services/moneyReports";
import { REPORT_GROUP_BY_VALUES } from "../services/reportSeries";
import { defaultReportId, isReportId, type ReportDefinition, type ReportId } from "./config/reportCatalog";

/** Mismo tope que acepta el servidor para `contactId` (`parseAgingQuery`). */
const CONTACT_ID_MAX_LENGTH = 120;

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
 * | `page`       | base 1, de la tabla del reporte activo              | `1`                 |
 * | `limit`      | tamaño de página                                    | `10`                |
 *
 * Sin `from`, `to` ni `preset`, el rango es el de por defecto del reporte
 * activo (`defaultDatePreset` del catálogo): últimos 30 días en los reportes con
 * gráfico y fechas; sin rango en cierre del día y depreciación FX. Ese rango no
 * se escribe en la URL. `preset=custom` sin fechas es «todas las fechas»
 * elegido a propósito (ver `serializeReportsRange`).
 *
 * Cambiar cualquier parámetro (también `report`) devuelve `page` a 1. Cambiar
 * de reporte limpia además `bucket`, `contactId` y `currency`
 * (`toReportSwitchPatch`): un cliente no vale como filtro de cuentas por pagar.
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

/** Patch de la URL al elegir otro reporte: los filtros de dinero no se arrastran. */
export function toReportSwitchPatch(report: ReportId): Pick<ReportsListState, "report"> & MoneyReportParams {
  return { bucket: "", contactId: "", currency: "", report };
}

export type ReportsListFilters = {
  dateFilters: ReportDateRangeFilters;
  purchasesFilters: PurchasesReportFilters;
  stockCardFilters: StockCardReportFilters;
};

/**
 * Estado de la URL + rango ya resuelto (`parseDateRangeParams`) → filtros de los
 * reportes y de la exportación. `groupBy` y `compare` viajan en `dateFilters`;
 * `ReportsResultPanel` los pasa solo a los reportes que los admiten.
 */
export function toReportsFilters(
  state: Pick<ReportsListState, "compare" | "groupBy" | "productId" | "supplierId">,
  range: Pick<DateRangeChange, "from" | "to">,
): ReportsListFilters {
  const dateRange = { from: range.from, to: range.to };

  return {
    dateFilters: {
      ...dateRange,
      compare: state.compare === "1" ? true : undefined,
      groupBy: state.groupBy || undefined,
    },
    purchasesFilters: { ...dateRange, supplierId: state.supplierId || undefined },
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
