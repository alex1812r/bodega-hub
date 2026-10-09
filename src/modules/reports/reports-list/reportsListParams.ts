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
import { REPORT_GROUP_BY_VALUES } from "../services/reportSeries";
import { defaultReportId, isReportId, type ReportDefinition, type ReportId } from "./config/reportCatalog";

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
 * | `page`       | base 1, de la tabla del reporte activo              | `1`                 |
 * | `limit`      | tamaño de página                                    | `10`                |
 *
 * Sin `from`, `to` ni `preset`, el rango es el de por defecto del reporte
 * activo (`defaultDatePreset` del catálogo): últimos 30 días en los reportes con
 * gráfico y fechas; sin rango en cierre del día y depreciación FX. Ese rango no
 * se escribe en la URL. `preset=custom` sin fechas es «todas las fechas»
 * elegido a propósito (ver `serializeReportsRange`).
 *
 * Cambiar cualquier parámetro (también `report`) devuelve `page` a 1.
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
  page: listParams.page(),
  limit: listParams.limit(),
});

export type ReportsListState = UrlListStateOf<typeof reportsListSchema.shape>;

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
