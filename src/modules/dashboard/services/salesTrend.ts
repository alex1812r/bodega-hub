import type { DailySalesSeries } from "@/modules/reports/services/reportSeries";

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
