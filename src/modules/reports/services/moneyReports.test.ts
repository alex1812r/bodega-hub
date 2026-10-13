/**
 * @jest-environment node
 */

import { ApiError } from "@/lib/api/apiError";
import { getRolePermissions, type Permission, type UserRole } from "@/shared/auth/permissions";

import {
  agingDocumentHref,
  assertMoneyReportAccess,
  buildAgingSummary,
  buildCashCloseDifferencesReport,
  buildSalesByCategoryReport,
  buildSalesByHourReport,
  isoDaysBetween,
  isoWeekday,
  MONEY_REPORT_SLUGS,
  parseAgingQuery,
  parseCashCloseDifferencesQuery,
  parseMoneyReportRange,
  ratioPct,
  resolveAgingBucket,
  type MoneyReportSlug,
} from "./moneyReports";

function params(query: string) {
  return new URLSearchParams(query);
}

function badRequest(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) {
      return { message: error.message, status: error.status };
    }
    throw error;
  }

  return null;
}

describe("assertMoneyReportAccess", () => {
  const allows = (report: MoneyReportSlug, permissions: readonly Permission[], role: UserRole) => {
    try {
      assertMoneyReportAccess(report, { permissions, role });
      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      return false;
    }
  };

  it.each(["admin", "contador"] as const)("con los permisos por defecto, %s ve los cinco reportes", (role) => {
    for (const report of MONEY_REPORT_SLUGS) {
      expect([report, allows(report, getRolePermissions(role), role)]).toEqual([report, true]);
    }
  });

  it.each(["vendedor", "almacen", "superadmin"] as const)(
    "con los permisos por defecto, %s no ve ninguno",
    (role) => {
      for (const report of MONEY_REPORT_SLUGS) {
        expect([report, allows(report, getRolePermissions(role), role)]).toEqual([report, false]);
      }
    },
  );

  it("sin reports.view no entra aunque tenga los permisos de pagos y caja", () => {
    for (const report of MONEY_REPORT_SLUGS) {
      expect(allows(report, ["payments.manage", "sales.create", "cash.view", "payments.view", "purchases.view"], "contador")).toBe(false);
    }
  });

  it("solo con reports.view entra a ventas por hora y por categoría", () => {
    expect(MONEY_REPORT_SLUGS.filter((report) => allows(report, ["reports.view"], "contador"))).toEqual([
      "sales-by-hour",
      "sales-by-category",
    ]);
  });

  it("cuentas por cobrar: payments.manage o sales.create", () => {
    expect(allows("receivables-aging", ["reports.view", "payments.manage"], "contador")).toBe(true);
    expect(allows("receivables-aging", ["reports.view", "sales.create"], "vendedor")).toBe(true);
    expect(allows("receivables-aging", ["reports.view", "payments.view"], "contador")).toBe(false);
  });

  it("cuentas por pagar: payments.manage y un rol que vea pagos de compra", () => {
    expect(allows("payables-aging", ["reports.view", "payments.manage"], "contador")).toBe(true);
    expect(allows("payables-aging", ["reports.view", "payments.manage"], "admin")).toBe(true);
    expect(allows("payables-aging", ["reports.view", "payments.manage"], "vendedor")).toBe(false);
    expect(allows("payables-aging", ["reports.view", "payments.manage"], "almacen")).toBe(false);
    expect(allows("payables-aging", ["reports.view", "sales.create"], "contador")).toBe(false);
  });

  it("diferencias de cierre: cash.view", () => {
    expect(allows("cash-close-differences", ["reports.view", "cash.view"], "contador")).toBe(true);
    expect(allows("cash-close-differences", ["reports.view", "cash.operate"], "vendedor")).toBe(false);
  });
});

describe("parseMoneyReportRange", () => {
  it("devuelve el rango válido", () => {
    expect(parseMoneyReportRange(params("from=2026-05-01&to=2026-05-31"))).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    });
    expect(parseMoneyReportRange(params("from=2026-05-18&to=2026-05-18"))).toEqual({
      from: "2026-05-18",
      to: "2026-05-18",
    });
  });

  it.each([
    ["", /Indica las fechas/],
    ["to=2026-05-31", /Indica las fechas/],
    ["from=2026-05-01&to=", /Indica las fechas/],
    // "Desde el inicio" deja el reporte sin `from`: no hay rango que agregar.
    ["fromStart=1&from=2026-05-01&to=2026-05-31", /Indica las fechas/],
    ["from=2026-02-30&to=2026-05-31", /"desde" no es válida/],
    ["from=2026-05-01&to=31-05-2026", /"hasta" no es válida/],
    ["from=2026-05-02&to=2026-05-01", /no puede ser posterior/],
    ["from=2016-01-01&to=2026-05-01", /demasiado amplio/],
  ])("400 con \"%s\"", (query, message) => {
    const error = badRequest(() => parseMoneyReportRange(params(query)));

    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(message);
  });

  it("acepta justo 10 años", () => {
    expect(() => parseMoneyReportRange(params("from=2016-05-11&to=2026-05-18"))).not.toThrow();
  });
});

describe("parseAgingQuery", () => {
  it("sin parámetros: primera página por defecto y sin filtros", () => {
    expect(parseAgingQuery(params(""))).toEqual({ limit: 10, skip: 0 });
  });

  it("lee tramo, contacto y paginación (con los topes de la API)", () => {
    expect(parseAgingQuery(params("bucket=30%2B&contactId=%20abc%20&skip=40&limit=20"))).toEqual({
      bucket: "30+",
      contactId: "abc",
      limit: 20,
      skip: 40,
    });
    expect(parseAgingQuery(params("bucket=0-7&limit=5000&skip=-3"))).toEqual({ bucket: "0-7", limit: 100, skip: 0 });
    expect(parseAgingQuery(params("bucket=&contactId="))).toEqual({ limit: 10, skip: 0 });
  });

  it.each(["bucket=30", "bucket=0-30", "bucket=todos", `contactId=${"x".repeat(121)}`])("400 con \"%s\"", (query) => {
    expect(badRequest(() => parseAgingQuery(params(query)))?.status).toBe(400);
  });
});

describe("parseCashCloseDifferencesQuery", () => {
  it("el rango es opcional", () => {
    expect(parseCashCloseDifferencesQuery(params(""))).toEqual({ from: null, limit: 10, skip: 0, to: null });
    expect(parseCashCloseDifferencesQuery(params("from=2026-05-01&currency=ref&limit=50"))).toEqual({
      currency: "ref",
      from: "2026-05-01",
      limit: 50,
      skip: 0,
      to: null,
    });
  });

  it.each([
    ["currency=usd", /moneda no es válida/],
    ["currency=VES", /moneda no es válida/],
    ["from=hoy", /"desde" no es válida/],
    ["from=2026-05-02&to=2026-05-01", /no puede ser posterior/],
  ])("400 con \"%s\"", (query, message) => {
    const error = badRequest(() => parseCashCloseDifferencesQuery(params(query)));

    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(message);
  });
});

describe("fechas y tramos", () => {
  it("isoWeekday: lunes = 1 … domingo = 7", () => {
    expect(isoWeekday("2026-05-18")).toBe(1);
    expect(isoWeekday("2026-05-23")).toBe(6);
    expect(isoWeekday("2026-05-24")).toBe(7);
    expect(isoWeekday("2020-03-01")).toBe(7);
  });

  it("isoDaysBetween cuenta días de calendario y nunca es negativo", () => {
    expect(isoDaysBetween("2026-05-18", "2026-05-18")).toBe(0);
    expect(isoDaysBetween("2026-05-17", "2026-05-18")).toBe(1);
    expect(isoDaysBetween("2026-04-01", "2026-05-18")).toBe(47);
    expect(isoDaysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(isoDaysBetween("2026-05-20", "2026-05-18")).toBe(0);
  });

  it.each([
    [0, "0-7"],
    [7, "0-7"],
    [8, "8-30"],
    [30, "8-30"],
    [31, "30+"],
    [4000, "30+"],
  ])("resolveAgingBucket(%d) = %s", (days, bucket) => {
    expect(resolveAgingBucket(days)).toBe(bucket);
  });

  it("agingDocumentHref enlaza al detalle del documento", () => {
    expect(agingDocumentHref("sale", "abc")).toBe("/sales/abc");
    expect(agingDocumentHref("purchase", "abc")).toBe("/purchases/abc");
  });
});

describe("buildSalesByHourReport", () => {
  const range = { from: "2026-05-01", to: "2026-05-31" };

  it("sin filas: matriz 7×24 completa en cero", () => {
    const report = buildSalesByHourReport(range, []);

    expect(report.matrix).toHaveLength(7);
    expect(report.matrix.flat()).toHaveLength(168);
    expect(report.matrix.flat().every((cell) => cell.salesCount === 0 && cell.totalRef === 0 && cell.totalVes === 0)).toBe(true);
    expect(report.byHour.map((row) => row.hour)).toEqual(Array.from({ length: 24 }, (_unused, hour) => hour));
    expect(report.byWeekday.map((row) => row.dow)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(report.totals).toEqual({ salesCount: 0, totalRef: 0, totalVes: 0 });
  });

  it("suma varias filas de la misma celda (días distintos) y redondea al final", () => {
    const report = buildSalesByHourReport(range, [
      { dow: 1, hour: 9, salesCount: 2, totalRef: 0.1, totalVes: 5 },
      { dow: 1, hour: 9, salesCount: 1, totalRef: 0.2, totalVes: 10 },
      { dow: 7, hour: 23, salesCount: 4, totalRef: 40, totalVes: 2000 },
      { dow: 7, hour: 0, salesCount: 1, totalRef: 1.005, totalVes: 50.25 },
    ]);

    expect(report.matrix[0]![9]).toEqual({ salesCount: 3, totalRef: 0.3, totalVes: 15 });
    expect(report.matrix[6]![23]).toEqual({ salesCount: 4, totalRef: 40, totalVes: 2000 });
    expect(report.byWeekday[6]).toEqual({ dow: 7, salesCount: 5, totalRef: 41.01, totalVes: 2050.25 });
    expect(report.byHour[9]).toEqual({ hour: 9, salesCount: 3, totalRef: 0.3, totalVes: 15 });
    expect(report.totals).toEqual({ salesCount: 8, totalRef: 41.31, totalVes: 2065.25 });
    // Los totales por hora y por día suman lo mismo que la matriz.
    expect(report.byHour.reduce((sum, row) => sum + row.salesCount, 0)).toBe(8);
    expect(report.byWeekday.reduce((sum, row) => sum + row.salesCount, 0)).toBe(8);
  });

  it("ignora una fila fuera de la matriz en vez de romperla", () => {
    const report = buildSalesByHourReport(range, [
      { dow: 0, hour: 5, salesCount: 1, totalRef: 1, totalVes: 1 },
      { dow: 3, hour: 24, salesCount: 1, totalRef: 1, totalVes: 1 },
    ]);

    expect(report.totals.salesCount).toBe(0);
  });
});

describe("buildSalesByCategoryReport", () => {
  const range = { from: "2026-05-01", to: "2026-05-31" };

  it("agrupa por categoría, ordena por ingreso y calcula margen y markup", () => {
    const report = buildSalesByCategoryReport(range, [
      { categoryId: "a", categoryName: "Bebidas", costRef: 30, grossProfitRef: 20, revenueRef: 50, units: 5 },
      { categoryId: "b", categoryName: "Snacks", costRef: 80, grossProfitRef: 120, revenueRef: 200, units: 10 },
      { categoryId: "a", categoryName: "Bebidas", costRef: 10, grossProfitRef: 15, revenueRef: 25, units: 2 },
      { categoryId: null, categoryName: "Sin categoría", costRef: 5, grossProfitRef: -1, revenueRef: 4, units: 1 },
    ]);

    expect(report.items).toEqual([
      { categoryId: "b", categoryName: "Snacks", costRef: 80, grossProfitRef: 120, marginPct: 60, markupPct: 150, revenueRef: 200, units: 10 },
      { categoryId: "a", categoryName: "Bebidas", costRef: 40, grossProfitRef: 35, marginPct: 46.67, markupPct: 87.5, revenueRef: 75, units: 7 },
      { categoryId: null, categoryName: "Sin categoría", costRef: 5, grossProfitRef: -1, marginPct: -25, markupPct: -20, revenueRef: 4, units: 1 },
    ]);
    expect(report.totals).toEqual({
      costRef: 125,
      grossProfitRef: 154,
      marginPct: 55.2,
      markupPct: 123.2,
      revenueRef: 279,
      units: 18,
    });
  });

  it("margen null con ingreso 0 y markup null con costo 0", () => {
    const report = buildSalesByCategoryReport(range, [
      { categoryId: "gratis", categoryName: "Regalos", costRef: 3, grossProfitRef: -3, revenueRef: 0, units: 1 },
      { categoryId: "sin-costo", categoryName: "Servicios", costRef: 0, grossProfitRef: 9, revenueRef: 9, units: 1 },
    ]);

    expect(report.items.map((row) => [row.categoryId, row.marginPct, row.markupPct])).toEqual([
      ["sin-costo", 100, null],
      ["gratis", null, -100],
    ]);
    expect(ratioPct(1, 0)).toBeNull();
    expect(ratioPct(1, 3)).toBe(33.33);
  });
});

describe("buildAgingSummary", () => {
  it("devuelve siempre los tres tramos en orden y sus totales", () => {
    expect(
      buildAgingSummary([
        { bucket: "30+", documentsCount: 2, pendingRef: 10.1, pendingVes: 505 },
        { bucket: "0-7", documentsCount: 1, pendingRef: 0.2, pendingVes: 10 },
      ]),
    ).toEqual({
      buckets: [
        { bucket: "0-7", documentsCount: 1, pendingRef: 0.2, pendingVes: 10 },
        { bucket: "8-30", documentsCount: 0, pendingRef: 0, pendingVes: 0 },
        { bucket: "30+", documentsCount: 2, pendingRef: 10.1, pendingVes: 505 },
      ],
      totals: { documentsCount: 3, pendingRef: 10.3, pendingVes: 515 },
    });
  });
});

describe("buildCashCloseDifferencesReport", () => {
  const row = (currency: "ref" | "ves", difference: number, runningDifference: number) => ({
    cashSessionId: "cs",
    closeDate: "2026-05-10",
    closedAt: "2026-05-10T22:00:00.000Z",
    closedReason: "manual" as const,
    counted: 10 + difference,
    currency,
    difference,
    expected: 10,
    registerId: "r1",
    registerName: "Caja 1",
    runningCounted: 0,
    runningDifference,
    runningExpected: 0,
  });

  it("resta al acumulado y a los totales lo anterior al rango, por moneda", () => {
    const report = buildCashCloseDifferencesReport({
      page: [row("ves", 5, -95.5), row("ref", 1, 3)],
      query: { from: "2026-05-10", limit: 10, skip: 0, to: "2026-05-31" },
      total: 2,
      windows: {
        ref: { baseline: null, last: { counted: 30, difference: 3, expected: 27 }, sessionsCount: 4 },
        ves: {
          baseline: { counted: 900, difference: -100.5, expected: 1000.5 },
          last: { counted: 1150.25, difference: -15.15, expected: 1165.4 },
          sessionsCount: 2,
        },
      },
    });

    expect(report.items.map((item) => [item.currency, item.runningDifference])).toEqual([
      ["ves", 5],
      ["ref", 3],
    ]);
    expect(report.items[0]).not.toHaveProperty("runningCounted");
    expect(report.totals).toEqual([
      { counted: 250.25, currency: "ves", difference: 85.35, expected: 164.9, sessionsCount: 2 },
      { counted: 30, currency: "ref", difference: 3, expected: 27, sessionsCount: 4 },
    ]);
  });

  it("un rango sin cierres totaliza cero aunque haya historia anterior", () => {
    const report = buildCashCloseDifferencesReport({
      page: [],
      query: { from: "2026-06-01", limit: 10, skip: 0, to: "2026-06-30" },
      total: 0,
      windows: {
        ref: { baseline: null, last: null, sessionsCount: 0 },
        ves: { baseline: { counted: 900, difference: -100.5, expected: 1000.5 }, last: null, sessionsCount: 0 },
      },
    });

    expect(report.totals).toEqual([
      { counted: 0, currency: "ves", difference: 0, expected: 0, sessionsCount: 0 },
      { counted: 0, currency: "ref", difference: 0, expected: 0, sessionsCount: 0 },
    ]);
    expect(report).toMatchObject({ items: [], limit: 10, range: { from: "2026-06-01", to: "2026-06-30" }, skip: 0, total: 0 });
  });
});
