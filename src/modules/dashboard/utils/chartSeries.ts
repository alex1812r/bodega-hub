import moment from "moment";

import type { DashboardSalesTrendPoint } from "../hooks/useDashboard";

export type ChartSeriesPoint = {
  label: string;
  saleDate: string;
  totalRef: number;
};

export function buildChartSeries(
  items: DashboardSalesTrendPoint[],
  from: string,
  to: string,
): ChartSeriesPoint[] {
  const totals = new Map(items.map((item) => [item.saleDate, item.totalRef]));
  const points: ChartSeriesPoint[] = [];
  const cursor = moment(from);
  const end = moment(to);

  while (cursor.isSameOrBefore(end, "day")) {
    const saleDate = cursor.format("YYYY-MM-DD");

    points.push({
      label: cursor.format("DD/MM"),
      saleDate,
      totalRef: totals.get(saleDate) ?? 0,
    });
    cursor.add(1, "day");
  }

  return points;
}
