/**
 * REP-04 · paridad tabla / serie en mock: las filas de ventas diarias y de
 * ganancia bruta se filtran por `from` / `to` como en el servidor
 * (`sale_date` dentro del rango), para que tabla y gráfico cuadren.
 */
import { mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import { getDailySalesReport, getGrossProfitReport } from "./reports.mock-server";

// Una venta mock sin `storeId` pertenece a la tienda por defecto.
const STORE_ID = DEFAULT_STORE_ID;
const storeSales = mockSales.filter((sale) => (sale.storeId ?? DEFAULT_STORE_ID) === STORE_ID);
const days = [...new Set(storeSales.map((sale) => toCaracasDateKey(sale.createdAt)))].sort();
const LAST_DAY = days[days.length - 1];

function params(query: string) {
  return new URLSearchParams(`${query}&limit=100`);
}

describe.each([
  ["ventas diarias", getDailySalesReport],
  ["ganancia bruta", getGrossProfitReport],
] as const)("mock de %s: la tabla respeta el rango", (_name, getReport) => {
  it("los datos de prueba tienen ventas en más de un día", () => {
    expect(days.length).toBeGreaterThan(1);
  });

  it("sin rango devuelve todas las ventas de la tienda", () => {
    expect(getReport(params(""), STORE_ID).total).toBe(storeSales.length);
  });

  it("con `from` y `to` solo devuelve las filas de esos días", () => {
    const report = getReport(params(`from=${LAST_DAY}&to=${LAST_DAY}`), STORE_ID);
    const expected = storeSales.filter((sale) => toCaracasDateKey(sale.createdAt) === LAST_DAY);

    expect(report.total).toBe(expected.length);
    expect(report.total).toBeLessThan(storeSales.length);
    expect(report.items.every((row) => row.saleDate === LAST_DAY)).toBe(true);
  });

  it("con solo `from` o solo `to` acota por ese extremo", () => {
    const fromLast = getReport(params(`from=${LAST_DAY}`), STORE_ID);
    const untilFirst = getReport(params(`to=${days[0]}`), STORE_ID);

    expect(fromLast.total).toBeGreaterThan(0);
    expect(untilFirst.total).toBeGreaterThan(0);
    expect(fromLast.items.every((row) => row.saleDate >= LAST_DAY)).toBe(true);
    expect(untilFirst.items.every((row) => row.saleDate <= days[0])).toBe(true);
    expect(untilFirst.total).toBeLessThan(storeSales.length);
  });

  it("un rango sin ventas deja la tabla vacía y la serie en 0", () => {
    const report = getReport(params("from=2001-01-01&to=2001-01-07&groupBy=auto"), STORE_ID);

    expect(report.total).toBe(0);
    expect(report.series?.current).toHaveLength(7);
  });
});

describe("mock de ventas diarias: tabla y serie cuadran", () => {
  it("el total REF de las filas que cuentan como venta es el total de la serie", () => {
    const query = `from=${days[0]}&to=${LAST_DAY}&groupBy=auto`;
    const report = getDailySalesReport(params(query), STORE_ID);
    const countedIds = new Set(
      storeSales
        .filter((sale) => sale.status !== "cancelada" && sale.status !== "devuelta")
        .map((sale) => `${toCaracasDateKey(sale.createdAt)}|${sale.totalRef}`),
    );
    const tableTotal = report.items
      .filter((row) => countedIds.has(`${row.saleDate}|${row.totalRef}`))
      .reduce((total, row) => total + row.totalRef, 0);

    expect(report.series?.totals.current.totalRef).toBeCloseTo(tableTotal, 2);
  });
});
