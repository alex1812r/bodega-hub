import { shiftIsoDate } from "@bodega/core/dates";

import {
  type DailySalesSeries,
  isIsoDay,
  REPORT_GROUP_BY_AUTO,
  REPORT_SERIES_MAX_DAYS,
} from "@/modules/reports/services/reportSeries";

import { isTruthyQueryParam } from "../utils/kpiPeriod";

/** Un punto del flujo de ventas: un día, o un periodo si la serie va agrupada. */
export type DashboardSalesTrendItem = {
  paidVes: number;
  /** Día operativo `yyyy-mm-dd`; con serie agrupada, primer día del periodo. */
  saleDate: string;
  salesCount: number;
  totalRef: number;
  totalVes: number;
};

export type DashboardSalesTrend = {
  items: DashboardSalesTrendItem[];
  /**
   * Serie del rango sin huecos, con su agrupación efectiva y, con `compare=1`,
   * el periodo anterior. `null` si no llegaron `from` y `to`.
   */
  series: DailySalesSeries | null;
};

/**
 * Parámetros para pedir la serie al servicio de ventas diarias de Reportes (el
 * único que la calcula), o `null` si falta `from` o `to`. La agrupación es
 * automática salvo que llegue `groupBy`; de la tabla del reporte solo se pide
 * la página mínima, porque el dashboard no la usa.
 */
export function toSalesTrendSeriesParams(searchParams: URLSearchParams) {
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  if (!from || !to) {
    return null;
  }

  const params = new URLSearchParams({
    from,
    groupBy: searchParams.get("groupBy")?.trim() || "auto",
    limit: "1",
    skip: "0",
    to,
  });
  const compare = searchParams.get("compare");

  if (compare !== null) {
    params.set("compare", compare);
  }

  return params;
}

/**
 * Último día de una petición "desde el inicio" (`fromStart` + `to` válido), o
 * `null` si la petición no lo es. Con `fromStart` el `from` se ignora, igual
 * que en las métricas.
 */
export function readSalesTrendFromStartTo(searchParams: URLSearchParams) {
  const to = searchParams.get("to")?.trim();

  return isTruthyQueryParam(searchParams.get("fromStart")) && to && isIsoDay(to) ? to : null;
}

/**
 * Parámetros de la serie "desde el inicio": del primer día con ventas hasta
 * `to`, con agrupación automática y sin periodo anterior (no hay con qué
 * comparar). Sin ventas, la serie es solo el día `to`. Si la historia supera
 * el máximo de la serie, se queda con los últimos `REPORT_SERIES_MAX_DAYS` días.
 */
export function toSalesTrendFromStartParams(to: string, firstSaleDay: string | null) {
  const earliest = shiftIsoDate(to, -(REPORT_SERIES_MAX_DAYS - 1));
  const first = firstSaleDay && firstSaleDay <= to ? firstSaleDay : to;

  return new URLSearchParams({
    from: first < earliest ? earliest : first,
    groupBy: REPORT_GROUP_BY_AUTO,
    limit: "1",
    skip: "0",
    to,
  });
}

export function salesTrendFromSeries(series: DailySalesSeries | undefined): DashboardSalesTrend {
  return {
    items: (series?.current ?? []).map((bucket) => ({
      paidVes: bucket.paidVes,
      saleDate: bucket.key,
      salesCount: bucket.count,
      totalRef: bucket.totalRef,
      totalVes: bucket.totalVes,
    })),
    series: series ?? null,
  };
}
