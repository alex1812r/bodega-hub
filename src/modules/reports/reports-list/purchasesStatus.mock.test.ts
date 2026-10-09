/**
 * @jest-environment node
 *
 * REP-07b · filtro de estado del reporte de compras: lo que suma la tabla es lo
 * que dice el gráfico, con el estado por defecto (sin canceladas ni devueltas),
 * con «Todas» y con cada estado. Se comprueba contra el servicio mock, con los
 * mismos parámetros que manda la pantalla.
 */
import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { roundMoney } from "@/shared/utils/currency";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getPurchasesReport } from "../services/reports.mock-server";
import { PURCHASE_REPORT_STATUSES } from "../services/reportSeries";

/** Los datos de prueba de compras caen dentro de este rango. */
const RANGE = { from: "2026-01-01", to: "2026-12-31" };

/** Todas las filas del reporte (página a página) y su serie. */
function readReport(status?: string) {
  const rows: { status: string; totalRef: number; totalVes: number }[] = [];
  let series: ReturnType<typeof getPurchasesReport>["series"];
  let total = Number.POSITIVE_INFINITY;

  for (let skip = 0; skip < total; skip += MAX_PAGE_LIMIT) {
    const page = getPurchasesReport(
      new URLSearchParams({
        ...RANGE,
        groupBy: "auto",
        limit: String(MAX_PAGE_LIMIT),
        skip: String(skip),
        ...(status ? { status } : {}),
      }),
      DEFAULT_STORE_ID,
    );

    rows.push(...page.items);
    series = page.series;
    total = page.total;
  }

  return { rows, series, total };
}

function sum(rows: readonly { totalRef: number; totalVes: number }[]) {
  return {
    count: rows.length,
    totalRef: roundMoney(rows.reduce((total, row) => total + row.totalRef, 0)),
    totalVes: roundMoney(rows.reduce((total, row) => total + row.totalVes, 0)),
  };
}

describe("reporte de compras · estado (mock)", () => {
  it("por defecto: la suma de las filas es el total de la serie y no hay canceladas ni devueltas", () => {
    const { rows, series, total } = readReport();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(total);
    expect(series?.totals.current).toEqual(sum(rows));
    expect(rows.filter((row) => row.status === "cancelado" || row.status === "devuelto")).toEqual([]);
  });

  it("status=all: la suma de las filas es el total de la serie e incluye todos los estados", () => {
    const all = readReport("all");
    const byDefault = readReport();

    expect(all.rows).toHaveLength(all.total);
    expect(all.series?.totals.current).toEqual(sum(all.rows));
    expect(all.total).toBeGreaterThanOrEqual(byDefault.total);
    // «Todas» = vigentes + canceladas + devueltas.
    expect(all.total).toBe(
      byDefault.total + readReport("cancelado").total + readReport("devuelto").total,
    );
  });

  it.each(PURCHASE_REPORT_STATUSES)("status=%s: solo ese estado, y tabla y serie cuadran", (status) => {
    const { rows, series, total } = readReport(status);

    expect(rows).toHaveLength(total);
    expect(rows.every((row) => row.status === status)).toBe(true);
    expect(series?.totals.current).toEqual(sum(rows));
  });
});
