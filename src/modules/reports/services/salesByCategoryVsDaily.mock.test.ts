/**
 * @jest-environment node
 *
 * REP-F6 · «Ventas y margen por categoría» sumaba ref 116.00 y «Ventas diarias»
 * ref 115.00 para el mismo rango. No es un defecto del mock ni un redondeo: los
 * dos reportes cuentan las MISMAS ventas (mismos estados, mismo día Caracas),
 * pero miden cosas distintas, igual que en el servidor real:
 *
 * - por categoría (`report_sales_by_category`) = suma de `sale_items.subtotal_ref`,
 *   el ingreso de las líneas, la misma base que la ganancia bruta;
 * - ventas diarias (`daily_sales_summary`) = suma de `sales.total_ref`, el total
 *   del documento: líneas − descuento del documento + impuestos.
 *
 * La diferencia es exactamente descuento − impuestos de las ventas del rango.
 */
import { mockSaleItems, mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import { getSalesByCategoryReport } from "./moneyReports.mock-server";
import { getDailySalesReport, getGrossProfitReport } from "./reports.mock-server";
import { SERIES_EXCLUDED_SALE_STATUSES } from "./reportSeries";

const RANGE = { from: "2026-04-19", to: "2026-05-18" };

function seriesTotals<T>(report: { series?: { totals: { current: T } } }) {
  if (!report.series) {
    throw new Error("El reporte no trae serie");
  }

  return report.series.totals.current;
}

describe("mock · ventas por categoría frente a ventas diarias", () => {
  const params = new URLSearchParams({ ...RANGE, groupBy: "auto" });
  const daily = seriesTotals(getDailySalesReport(params, DEFAULT_STORE_ID));
  const byCategory = getSalesByCategoryReport(RANGE, DEFAULT_STORE_ID);
  // Las ventas del rango con el criterio de los dos reportes.
  const sales = mockSales.filter((sale) => {
    const day = toCaracasDateKey(sale.createdAt);

    return (
      (sale.storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID &&
      !(SERIES_EXCLUDED_SALE_STATUSES as readonly string[]).includes(sale.status) &&
      day >= RANGE.from &&
      day <= RANGE.to
    );
  });

  it("los dos reportes cuentan las mismas ventas", () => {
    expect(sales.length).toBeGreaterThan(0);
    expect(daily.count).toBe(sales.length);
    expect(daily.totalRef).toBeCloseTo(
      sales.reduce((total, sale) => total + sale.totalRef, 0),
      2,
    );
    expect(byCategory.totals.revenueRef).toBeCloseTo(
      mockSaleItems
        .filter((item) => sales.some((sale) => sale.id === item.saleId))
        .reduce((total, item) => total + item.subtotalRef, 0),
      2,
    );
  });

  it("la diferencia entre ambos es el descuento menos los impuestos de esos documentos", () => {
    const documentAdjustments = sales.reduce(
      (total, sale) => total + sale.discountRef - sale.taxRef,
      0,
    );

    expect(documentAdjustments).not.toBe(0);
    expect(byCategory.totals.revenueRef - daily.totalRef).toBeCloseTo(documentAdjustments, 2);
  });

  it("por categoría cuadra con la ganancia bruta, que usa la misma base (líneas)", () => {
    const grossProfit = seriesTotals(getGrossProfitReport(params, DEFAULT_STORE_ID));

    expect(byCategory.totals.revenueRef).toBeCloseTo(grossProfit.revenueRef, 2);
    expect(byCategory.totals.grossProfitRef).toBeCloseTo(grossProfit.grossProfitRef, 2);
  });
});
