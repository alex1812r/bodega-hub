/**
 * @jest-environment node
 */

/**
 * DEC-01: una venta en `borrador` no es una venta para ningún reporte, gráfico,
 * ranking ni KPI. El criterio vive en `countedSaleStatuses.ts` y lo aplican
 * igual los servicios reales (sobre un PostgREST en memoria) y los del mock.
 */
jest.mock("../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import * as dashboardMock from "@/modules/dashboard/services/dashboard.mock-server";
import {
  getDashboardMetrics,
  getDashboardSummary,
} from "@/modules/dashboard/services/dashboard.server";
import { getFxDepreciationReport as getFxDepreciationReportMock } from "@/modules/reports/services/fxDepreciationReport.mock-server";
import { getFxDepreciationReport } from "@/modules/reports/services/fxDepreciationReport.server";
import * as moneyReportsMock from "@/modules/reports/services/moneyReports.mock-server";
import * as reportsMock from "@/modules/reports/services/reports.mock-server";
import { getTopCustomersReport, getTopProductsReport } from "@/modules/reports/services/reports.server";
import { createFakePostgrest } from "@/modules/reports/services/testing/fakePostgrest";
import {
  mockPayments,
  mockSaleItems,
  mockSales,
  type SaleStatus,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { getCaracasIsoDate, shiftIsoDate } from "@/shared/utils/caracasBusinessDay";

import {
  COUNTED_SALE_STATUSES,
  countsAsSale,
  NOT_COUNTED_SALE_STATUSES,
} from "./countedSaleStatuses";

const ALL_STATUSES: SaleStatus[] = ["borrador", "pendiente_pago", "pagada", "cancelada", "devuelta"];

describe("criterio único de ventas que cuentan", () => {
  it("cuentan pendiente_pago y pagada; no cuentan borrador, cancelada ni devuelta", () => {
    expect([...COUNTED_SALE_STATUSES].sort()).toEqual(["pagada", "pendiente_pago"]);
    expect([...NOT_COUNTED_SALE_STATUSES].sort()).toEqual(["borrador", "cancelada", "devuelta"]);
    expect(ALL_STATUSES.filter(countsAsSale).sort()).toEqual(["pagada", "pendiente_pago"]);
    // Las dos listas parten el enum: ningún estado queda sin clasificar.
    expect([...COUNTED_SALE_STATUSES, ...NOT_COUNTED_SALE_STATUSES].sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("un estado desconocido no cuenta", () => {
    expect(countsAsSale("en_revision")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Servicios reales sobre un PostgREST en memoria
// ---------------------------------------------------------------------------

const STORE = "store-0000-0000-0000-000000000001";
const TODAY = getCaracasIsoDate();
const YESTERDAY = shiftIsoDate(TODAY, -1);
/** Mediodía de Caracas (16:00 UTC) del día dado. */
const noon = (day: string) => `${day}T16:00:00.000Z`;

type Row = Record<string, unknown>;

function sale(id: string, status: SaleStatus, day: string, totalRef: number): Row {
  return {
    created_at: noon(day),
    customer_id: "customer-1",
    id,
    invoice_number: `V-${id}`,
    paid_ves: status === "pagada" ? totalRef * 10 : 0,
    ref_rate_ves: 10,
    status,
    store_id: STORE,
    total_ref: totalRef,
    total_ves: totalRef * 10,
  };
}

/** Una venta por estado hoy (10, 20, 40, 80, 160 REF) y otra pagada + otro borrador ayer. */
function database(extraPayments: Row[] = []) {
  const sales = [
    sale("s-pagada", "pagada", TODAY, 10),
    sale("s-pendiente", "pendiente_pago", TODAY, 20),
    sale("s-borrador", "borrador", TODAY, 40),
    sale("s-cancelada", "cancelada", TODAY, 80),
    sale("s-devuelta", "devuelta", TODAY, 160),
    sale("s-ayer-pagada", "pagada", YESTERDAY, 5),
    sale("s-ayer-borrador", "borrador", YESTERDAY, 320),
  ];
  const fake = createFakePostgrest({
    contacts: [{ id: "customer-1", is_active: true, name: "Cliente", store_id: STORE, type: "cliente" }],
    exchange_rates: [{ created_at: noon(TODAY), id: "rate-1", rate_ves: 10, store_id: STORE }],
    low_stock_products: [],
    payments: [
      {
        amount_ref: 10,
        amount_ves: 100,
        id: "pay-1",
        method: "punto_venta",
        sale_id: "s-pagada",
        status: "activo",
        store_id: STORE,
      },
      ...extraPayments,
    ],
    products: [{ id: "product-1", name: "Producto", sku: "P-1" }],
    // Una línea de 1 unidad por venta, con el importe de la venta.
    sale_items: sales.map((row) => ({
      id: `item-${String(row.id)}`,
      product_id: "product-1",
      quantity: 1,
      sale_id: row.id,
      subtotal_ref: row.total_ref,
    })),
    sales,
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);
}

const RANGE = new URLSearchParams({ from: YESTERDAY, limit: "100", to: TODAY });

describe("servicios reales: el borrador no cuenta", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resumen del dashboard: hoy y ayer sin borradores (ni canceladas ni devueltas)", async () => {
    database();

    const summary = await getDashboardSummary(STORE);

    expect({
      previousDayTotalRef: summary.previousDayTotalRef,
      salesCount: summary.salesCount,
      totalRef: summary.totalRef,
      totalVes: summary.totalVes,
    }).toEqual({ previousDayTotalRef: 5, salesCount: 2, totalRef: 30, totalVes: 300 });
  });

  it("métricas del dashboard (y con ellas el cierre del día y el asistente): 3 ventas, 35 REF, 3 unidades", async () => {
    database();

    const metrics = await getDashboardMetrics(RANGE, STORE);

    expect(metrics).toEqual(
      expect.objectContaining({ paidVes: 150, salesCount: 3, totalRef: 35, totalVes: 350, unitsSold: 3 }),
    );
  });

  it("top productos y top clientes: solo las ventas que cuentan", async () => {
    database();

    const products = await getTopProductsReport(RANGE, STORE);
    const customers = await getTopCustomersReport(RANGE, STORE);

    expect(products.items).toEqual([
      expect.objectContaining({ productId: "product-1", revenueRef: 35, unitsSold: 3 }),
    ]);
    expect(customers.items).toEqual([
      expect.objectContaining({ customerId: "customer-1", salesCount: 3, totalRef: 35, totalVes: 350 }),
    ]);
  });

  it("depreciación FX: el pago de un borrador (estado que ninguna RPC produce) no entra", async () => {
    database();
    const baseline = await getFxDepreciationReport(RANGE, STORE);

    database([
      {
        amount_ref: 40,
        amount_ves: 400,
        id: "pay-borrador",
        method: "punto_venta",
        sale_id: "s-borrador",
        status: "activo",
        store_id: STORE,
      },
    ]);
    const withDraftPayment = await getFxDepreciationReport(RANGE, STORE);

    expect(baseline.total).toBe(1);
    expect(withDraftPayment.total).toBe(1);
    expect(withDraftPayment.summary.vesExposed).toBe(baseline.summary.vesExposed);
    expect(withDraftPayment.items.map((row) => row.saleId)).toEqual(["s-pagada"]);
  });
});

// ---------------------------------------------------------------------------
// Mock: paridad con el criterio
// ---------------------------------------------------------------------------

/** El mock trae una venta en borrador (`sale-003`, 40 REF, 2026-05-17) con líneas. */
const WIDE = { from: "2026-01-01", to: "2026-12-31" };
const wide = (extra: Record<string, string> = {}) => new URLSearchParams({ ...WIDE, limit: "100", ...extra });

function inDefaultStore(storeId: string | null | undefined) {
  return (storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID;
}

const storeSales = mockSales.filter((item) => inDefaultStore(item.storeId));
const counted = storeSales.filter((item) => countsAsSale(item.status));
const countedIds = new Set(counted.map((item) => item.id));
const countedItems = mockSaleItems.filter((item) => countedIds.has(item.saleId));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const expected = {
  costRef: sum(countedItems.map((item) => item.unitCostRefSnapshot * item.quantity)),
  paidVes: sum(counted.map((item) => item.paidVes)),
  revenueRef: sum(countedItems.map((item) => item.subtotalRef)),
  salesCount: counted.length,
  totalRef: sum(counted.map((item) => item.totalRef)),
  totalVes: sum(counted.map((item) => item.totalVes)),
  units: sum(countedItems.map((item) => item.quantity)),
};

describe("mock: mismo criterio que el servidor", () => {
  it("los datos del mock tienen un borrador con líneas, además de canceladas y devueltas", () => {
    const draft = storeSales.filter((item) => item.status === "borrador");

    expect(draft.map((item) => item.id)).toEqual(["sale-003"]);
    expect(mockSaleItems.filter((item) => item.saleId === "sale-003").length).toBeGreaterThan(0);
    expect(storeSales.some((item) => item.status === "cancelada")).toBe(true);
    expect(storeSales.some((item) => item.status === "devuelta")).toBe(true);
  });

  it("ventas diarias y ganancia bruta (tabla y serie)", () => {
    const daily = reportsMock.getDailySalesReport(wide({ groupBy: "month" }), DEFAULT_STORE_ID);
    const profit = reportsMock.getGrossProfitReport(wide({ groupBy: "month" }), DEFAULT_STORE_ID);

    expect(sum(daily.items.map((row) => row.salesCount))).toBe(expected.salesCount);
    expect(sum(daily.items.map((row) => row.totalRef))).toBeCloseTo(expected.totalRef, 6);
    expect(sum(daily.items.map((row) => row.paidVes))).toBeCloseTo(expected.paidVes, 6);
    expect(daily.series?.totals.current.count).toBe(expected.salesCount);
    expect(daily.series?.totals.current.totalRef).toBeCloseTo(expected.totalRef, 6);
    expect(sum(profit.items.map((row) => row.revenueRef))).toBeCloseTo(expected.revenueRef, 6);
    expect(sum(profit.items.map((row) => row.costRef))).toBeCloseTo(expected.costRef, 6);
    // El día del borrador (2026-05-17) no aparece: ese día solo tiene esa venta.
    expect(daily.items.map((row) => row.saleDate)).not.toContain("2026-05-17");
  });

  it("rentabilidad por producto y compras por cliente (vistas sin fecha)", () => {
    const products = reportsMock.getProductProfitabilityReport(new URLSearchParams("limit=100"), DEFAULT_STORE_ID);
    const customers = reportsMock.getCustomerPurchasesReport(new URLSearchParams("limit=100"), DEFAULT_STORE_ID);

    expect(sum(products.items.map((row) => row.unitsSold))).toBe(expected.units);
    expect(sum(products.items.map((row) => row.revenueRef))).toBeCloseTo(expected.revenueRef, 6);
    expect(sum(products.items.map((row) => row.costRef))).toBeCloseTo(expected.costRef, 6);
    expect(sum(customers.items.map((row) => row.salesCount))).toBe(expected.salesCount);
    expect(sum(customers.items.map((row) => row.totalRef))).toBeCloseTo(expected.totalRef, 6);
    expect(sum(customers.items.map((row) => row.totalVes))).toBeCloseTo(expected.totalVes, 6);
  });

  it("top productos y top clientes", () => {
    const products = reportsMock.getTopProductsReport(wide(), DEFAULT_STORE_ID);
    const customers = reportsMock.getTopCustomersReport(wide(), DEFAULT_STORE_ID);

    expect(sum(products.items.map((row) => row.unitsSold))).toBe(expected.units);
    expect(sum(customers.items.map((row) => row.salesCount))).toBe(expected.salesCount);
    expect(sum(customers.items.map((row) => row.totalRef))).toBeCloseTo(expected.totalRef, 6);
  });

  it("ventas por hora y por categoría", () => {
    const byHour = moneyReportsMock.getSalesByHourReport(WIDE, DEFAULT_STORE_ID);
    const byCategory = moneyReportsMock.getSalesByCategoryReport(WIDE, DEFAULT_STORE_ID);

    expect(byHour.totals.salesCount).toBe(expected.salesCount);
    expect(byHour.totals.totalRef).toBeCloseTo(expected.totalRef, 2);
    expect(byCategory.totals.units).toBe(expected.units);
    expect(byCategory.totals.revenueRef).toBeCloseTo(expected.revenueRef, 2);
  });

  it("dashboard: métricas, resumen (ayer = día del borrador) y tendencia sin rango de serie", () => {
    const metrics = dashboardMock.getDashboardMetrics(wide(), DEFAULT_STORE_ID);
    const summary = dashboardMock.getDashboardSummary(DEFAULT_STORE_ID);
    const trend = dashboardMock.getDashboardSalesTrend(new URLSearchParams(), DEFAULT_STORE_ID);

    expect(metrics.salesCount).toBe(expected.salesCount);
    expect(metrics.totalRef).toBeCloseTo(expected.totalRef, 6);
    expect(metrics.unitsSold).toBe(expected.units);
    // El "hoy" del mock es 2026-05-18: el borrador es de ayer y ayer no hubo otra venta.
    expect(summary.previousDayTotalRef).toBe(0);
    expect(trend.items.every((row) => row.saleDate !== "2026-05-17")).toBe(true);
  });

  it("depreciación FX: ningún pago de una venta en borrador", () => {
    const draftPayment = {
      ...mockPayments.find((payment) => payment.saleId && countedIds.has(payment.saleId))!,
      id: "pay-draft-dec01",
      saleId: "sale-003",
    };

    mockPayments.push(draftPayment);

    try {
      const fx = getFxDepreciationReportMock(wide(), DEFAULT_STORE_ID);

      expect(fx.items.map((row) => row.saleId)).not.toContain("sale-003");
    } finally {
      mockPayments.splice(mockPayments.indexOf(draftPayment), 1);
    }
  });
});
