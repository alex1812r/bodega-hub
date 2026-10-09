/**
 * REP-04 / REP-F2 · el mock de ventas diarias y de ganancia bruta devuelve lo
 * mismo que las vistas `daily_sales_summary` / `gross_profit_summary`: una fila
 * por día operativo de Caracas, sin ventas canceladas ni devueltas, filtrada por
 * `from` / `to`. Así la suma de la tabla es el total del gráfico.
 */
import { mockProducts, mockSaleItems, mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import {
  getDailySalesReport,
  getGrossProfitReport,
  getStockCard,
  getTopProductsReport,
} from "./reports.mock-server";

// Una venta mock sin `storeId` pertenece a la tienda por defecto.
const STORE_ID = DEFAULT_STORE_ID;
const storeSales = mockSales.filter((sale) => (sale.storeId ?? DEFAULT_STORE_ID) === STORE_ID);
const countedSales = storeSales.filter(
  (sale) => sale.status !== "cancelada" && sale.status !== "devuelta",
);
const saleIdsWithItems = new Set(mockSaleItems.map((item) => item.saleId));

function daysOf(sales: typeof countedSales) {
  return [...new Set(sales.map((sale) => toCaracasDateKey(sale.createdAt)))].sort();
}

const salesDays = daysOf(countedSales);
// `gross_profit_summary` une con las líneas: una venta sin líneas no aporta día.
const profitDays = daysOf(countedSales.filter((sale) => saleIdsWithItems.has(sale.id)));
const ALL_DAYS = `from=${salesDays[0]}&to=${salesDays[salesDays.length - 1]}`;

function params(query: string) {
  return new URLSearchParams(`${query}&limit=100`);
}

function sum(values: number[]) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
}

describe.each([
  ["ventas diarias", getDailySalesReport, salesDays],
  ["ganancia bruta", getGrossProfitReport, profitDays],
] as const)("mock de %s: la tabla es la vista diaria", (_name, getReport, days) => {
  const LAST_DAY = days[days.length - 1];

  it("los datos de prueba tienen ventas en más de un día y alguna cancelada o devuelta", () => {
    expect(days.length).toBeGreaterThan(1);
    expect(countedSales.length).toBeLessThan(storeSales.length);
  });

  it("sin rango devuelve una fila por día con ventas, del más reciente al más antiguo", () => {
    const report = getReport(params(""), STORE_ID);

    expect(report.items.map((row) => row.saleDate)).toEqual([...days].reverse());
    expect(report.total).toBe(days.length);
  });

  it("con `from` y `to` solo devuelve las filas de esos días", () => {
    const report = getReport(params(`from=${LAST_DAY}&to=${LAST_DAY}`), STORE_ID);

    expect(report.items.map((row) => row.saleDate)).toEqual([LAST_DAY]);
  });

  it("con solo `from` o solo `to` acota por ese extremo", () => {
    const fromLast = getReport(params(`from=${LAST_DAY}`), STORE_ID);
    const untilFirst = getReport(params(`to=${days[0]}`), STORE_ID);

    expect(fromLast.items.map((row) => row.saleDate)).toEqual([LAST_DAY]);
    expect(untilFirst.items.map((row) => row.saleDate)).toEqual([days[0]]);
  });

  it("un rango sin ventas deja la tabla vacía y la serie en 0", () => {
    const report = getReport(params("from=2001-01-01&to=2001-01-07&groupBy=auto"), STORE_ID);

    expect(report.total).toBe(0);
    expect(report.series?.current).toHaveLength(7);
  });
});

describe("mock de reportes de producto: traen el nombre (REP-F2)", () => {
  const nameById = new Map(mockProducts.map((product) => [product.id, product.name]));

  it("top productos devuelve nombre y SKU", () => {
    const { items } = getTopProductsReport(params(""), STORE_ID);

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.name).toBe(nameById.get(item.productId));
      expect(item.sku).not.toBe("");
    }
  });

  it("el kardex devuelve nombre y SKU del producto, como la vista stock_card", () => {
    const { items } = getStockCard(params(""), STORE_ID);

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.productName).toBe(nameById.get(item.productId));
      expect(item.sku).not.toBe("");
    }
  });
});

describe("mock de ventas diarias y ganancia bruta: tabla y serie cuadran (REP-F2)", () => {
  it("ventas diarias: no cuenta canceladas ni devueltas y suma lo mismo que la serie", () => {
    const report = getDailySalesReport(params(`${ALL_DAYS}&groupBy=auto`), STORE_ID);

    expect(sum(report.items.map((row) => row.salesCount))).toBe(countedSales.length);
    expect(sum(report.items.map((row) => row.totalRef))).toBe(
      sum(countedSales.map((sale) => sale.totalRef)),
    );
    expect(sum(report.items.map((row) => row.totalRef))).toBe(report.series?.totals.current.totalRef);
    expect(sum(report.items.map((row) => row.totalVes))).toBe(report.series?.totals.current.totalVes);
  });

  it("ganancia bruta: suma las líneas de las ventas que cuentan y cuadra con la serie", () => {
    const report = getGrossProfitReport(params(`${ALL_DAYS}&groupBy=auto`), STORE_ID);
    const countedIds = new Set(countedSales.map((sale) => sale.id));
    const revenue = sum(
      mockSaleItems.filter((item) => countedIds.has(item.saleId)).map((item) => item.subtotalRef),
    );

    expect(sum(report.items.map((row) => row.revenueRef))).toBe(revenue);
    expect(sum(report.items.map((row) => row.grossProfitRef))).toBe(
      report.series?.totals.current.grossProfitRef,
    );
  });
});
