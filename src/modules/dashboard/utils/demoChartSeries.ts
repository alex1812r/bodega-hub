import moment from "moment";

import type { DashboardSalesTrendPoint } from "../hooks/useDashboard";

/** Serie demo alineada con el mockup Stitch (7 dias). */
const DEMO_DAILY_REF = [120, 180, 140, 260, 210, 300, 452];

export function buildDemoSalesTrend(from: string, to: string): DashboardSalesTrendPoint[] {
  const points: DashboardSalesTrendPoint[] = [];
  const cursor = moment(from);
  const end = moment(to);
  let index = 0;

  while (cursor.isSameOrBefore(end, "day")) {
    const totalRef = DEMO_DAILY_REF[index % DEMO_DAILY_REF.length] ?? 0;

    points.push({
      paidVes: totalRef * 510,
      saleDate: cursor.format("YYYY-MM-DD"),
      salesCount: Math.max(1, Math.round(totalRef / 40)),
      totalRef,
      totalVes: totalRef * 510,
    });
    cursor.add(1, "day");
    index += 1;
  }

  return points;
}
