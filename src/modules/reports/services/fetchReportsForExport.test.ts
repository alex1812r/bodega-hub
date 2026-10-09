/**
 * @jest-environment node
 */

import { getRolePermissions, type UserRole } from "@/shared/auth/permissions";

import type { ReportsExportView } from "../utils/reportExportView";
import { fetchReportsForExport, type ReportsExportFilters } from "./fetchReportsForExport";

const MULTI_STORE_SLUGS = [
  "customer-purchases",
  "daily-close",
  "daily-sales",
  "fx-depreciation",
  "gross-profit",
  "low-stock",
  "payment-methods",
  "product-profitability",
  "purchases",
  "supplier-purchases",
  "top-customers",
  "top-products",
];
const MONEY_SLUGS = [
  "cash-close-differences",
  "payables-aging",
  "receivables-aging",
  "sales-by-category",
  "sales-by-hour",
];
const INVENTORY_SLUGS = ["dead-stock", "stock-adjustments", "stock-turnover"];

const dailyCloseSummary = {
  cash: null,
  fx: { capitalRefToday: 80, vesLossRef: 2.5 },
  paymentsSummary: { paymentCount: 4, totalRef: 90 },
  sales: { salesCount: 3, totalRef: 100, totalVes: 3650 },
  vault: { balanceRef: 40 },
};

const emptyHourCell = { salesCount: 0, totalRef: 0, totalVes: 0 };

function salesByHourReport() {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => emptyHourCell));

  // Martes a las 09:00 y domingo a las 18:00.
  matrix[1]![9] = { salesCount: 2, totalRef: 30, totalVes: 1095 };
  matrix[6]![18] = { salesCount: 1, totalRef: 12, totalVes: 438 };

  return { byHour: [], byWeekday: [], matrix, range: {}, totals: emptyHourCell };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status < 400,
    status,
  } as unknown as Response;
}

type Lists = Record<string, unknown[]>;

/**
 * BFF de prueba: cada lista paginada se sirve desde `lists[slug]` (vacía si no
 * está) y las rutas que no existirían para la sesión responden 403.
 */
function installApi(lists: Lists = {}, options: { forbidden?: string[]; settings?: unknown } = {}) {
  const requests: URL[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const slug = url.pathname.split("/").pop() ?? "";

    requests.push(url);

    if (options.forbidden?.includes(slug)) {
      return jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403);
    }

    if (url.pathname === "/api/settings") {
      return jsonResponse({ data: options.settings ?? { businessName: "Bodega Demo" } });
    }

    if (slug === "daily-close") {
      return jsonResponse({ data: dailyCloseSummary });
    }

    if (slug === "sales-by-hour") {
      return jsonResponse({ data: salesByHourReport() });
    }

    if (slug === "sales-by-category") {
      return jsonResponse({ data: { items: lists[slug] ?? [], range: {}, totals: {} } });
    }

    const list = lists[slug] ?? [];
    const skip = Number(url.searchParams.get("skip") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);

    return jsonResponse({
      data: {
        items: list.slice(skip, skip + limit),
        limit,
        skip,
        summary:
          slug === "fx-depreciation"
            ? { capitalRefToday: 80, depreciationPctOnVes: 3.1, valuationRateVes: 36.5, vesLossRef: 2.5 }
            : undefined,
        total: list.length,
      },
    });
  }) as unknown as typeof fetch;

  return {
    paths: () => [...new Set(requests.map((url) => url.pathname))].sort(),
    query: (slug: string) =>
      Object.fromEntries(
        requests.find((url) => url.pathname.endsWith(`/${slug}`))?.searchParams ?? [],
      ),
    requests,
  };
}

function viewFor(role: UserRole, overrides: Partial<ReportsExportView> = {}): ReportsExportView {
  return {
    activeReportId: "daily-sales",
    compare: false,
    viewer: { permissions: getRolePermissions(role), role },
    ...overrides,
  };
}

const range = { from: "2026-09-01", to: "2026-09-30" };

function storeFilters(view?: ReportsExportView): ReportsExportFilters {
  return { dateFilters: range, purchasesFilters: range, stockCardFilters: {}, view };
}

function storePaths(slugs: string[]) {
  return slugs.map((slug) => `/api/reports/${slug}`).sort();
}

describe("fetchReportsForExport (REP-08)", () => {
  it("un admin exporta los 13 reportes multi-tienda, los 5 de dinero y los 3 de inventario", async () => {
    const api = installApi();

    const data = await fetchReportsForExport(storeFilters(viewFor("admin")));

    // Sin producto elegido el kardex no se pide.
    expect(api.paths()).toEqual(
      [
        "/api/settings",
        ...storePaths([...MULTI_STORE_SLUGS, ...MONEY_SLUGS, ...INVENTORY_SLUGS]),
      ].sort(),
    );
    expect(data.storeName).toBe("Bodega Demo");
    expect(data.deadStock).toEqual([]);
    expect(data.receivablesAging).toEqual([]);
    expect(data.stockCard).toEqual([]);
    expect(data.truncated).toBeUndefined();
  });

  it("no pide los reportes que la sesión no puede ver (darían 403)", async () => {
    // Contador: `reports.view` sin `inventory.view` ni `settings.view`
    // (REP-F6: `GET /api/settings` le contestaba 403 en cada exportación).
    const api = installApi({}, { forbidden: [...INVENTORY_SLUGS, "settings"] });

    const data = await fetchReportsForExport(storeFilters(viewFor("contador")));

    expect(api.paths()).toEqual(storePaths([...MULTI_STORE_SLUGS, ...MONEY_SLUGS]));
    expect(data.storeName).toBeUndefined();
    expect(data.salesByCategory).toEqual([]);
    expect(data.deadStock).toBeUndefined();
    expect(data.stockTurnover).toBeUndefined();
    expect(data.stockAdjustments).toBeUndefined();
  });

  it("mientras la sesión carga (sin rol) solo salen los 13 multi-tienda", async () => {
    const api = installApi({}, { forbidden: [...MONEY_SLUGS, ...INVENTORY_SLUGS, "settings"] });

    const data = await fetchReportsForExport(
      storeFilters({ activeReportId: "daily-sales", compare: false, viewer: { permissions: [], role: undefined } }),
    );

    expect(api.paths()).toEqual(storePaths(MULTI_STORE_SLUGS));
    expect(data.salesByHour).toBeUndefined();
    expect(data.cashCloseDifferences).toBeUndefined();
  });

  it("plataforma exporta solo los 13 multi-tienda, con su alcance, aunque llegue una vista", async () => {
    const api = installApi();

    const data = await fetchReportsForExport({
      ...storeFilters(viewFor("admin")),
      scope: { pathPrefix: "/api/platform/reports", storeIds: "s1,s2", storeScope: "selected" },
    });

    expect(api.paths()).toEqual(
      MULTI_STORE_SLUGS.map((slug) => `/api/platform/reports/${slug}`).sort(),
    );
    expect(api.query("daily-sales")).toMatchObject({ ...range, storeIds: "s1,s2", storeScope: "selected" });
    expect(data.storeName).toBeUndefined();
    expect(data.salesByHour).toBeUndefined();
    expect(data.deadStock).toBeUndefined();
  });

  it("sin vista (llamada antigua) se comporta como antes: 13 reportes y nada más", async () => {
    const api = installApi();

    await fetchReportsForExport(storeFilters());

    expect(api.paths()).toEqual(storePaths(MULTI_STORE_SLUGS));
  });

  it("compras reenvía el estado que se ve en pantalla y el proveedor", async () => {
    const api = installApi();

    await fetchReportsForExport({
      ...storeFilters(viewFor("admin", { activeReportId: "purchases", purchasesStatus: "recibido" })),
      purchasesFilters: { ...range, supplierId: "sup-1" },
    });

    expect(api.query("purchases")).toMatchObject({ ...range, status: "recibido", supplierId: "sup-1" });

    const fromProps = installApi();

    await fetchReportsForExport({
      ...storeFilters(viewFor("admin")),
      purchasesFilters: { ...range, status: "all" },
    });

    expect(fromProps.query("purchases")).toMatchObject({ status: "all" });
  });

  it("sin estado en la URL no manda `status`: el servicio excluye canceladas y devueltas", async () => {
    const api = installApi();

    await fetchReportsForExport(storeFilters(viewFor("admin")));

    expect(api.query("purchases")).not.toHaveProperty("status");
  });

  it("tramo, contacto, moneda, días y categoría solo se aplican al reporte abierto", async () => {
    const filters = {
      bucket: "30+",
      categoryId: "cat-1",
      contactId: "c-1",
      currency: "ref",
      days: 90,
      turnoverGroupBy: "category",
    } as const;
    const receivables = installApi();

    await fetchReportsForExport(
      storeFilters(viewFor("admin", { ...filters, activeReportId: "receivables-aging" })),
    );

    expect(receivables.query("receivables-aging")).toMatchObject({ bucket: "30+", contactId: "c-1" });
    expect(receivables.query("payables-aging")).not.toHaveProperty("contactId");
    expect(receivables.query("payables-aging")).not.toHaveProperty("bucket");
    // Cerrado, el cierre de caja sale con las dos monedas.
    expect(receivables.query("cash-close-differences")).not.toHaveProperty("currency");
    expect(receivables.query("dead-stock")).not.toHaveProperty("days");
    expect(receivables.query("stock-turnover")).not.toHaveProperty("groupBy");

    const cashClose = installApi();

    await fetchReportsForExport(
      storeFilters(viewFor("admin", { ...filters, activeReportId: "cash-close-differences" })),
    );

    expect(cashClose.query("cash-close-differences")).toMatchObject({ ...range, currency: "ref" });
    expect(cashClose.query("receivables-aging")).not.toHaveProperty("bucket");

    const deadStock = installApi();

    await fetchReportsForExport(
      storeFilters(viewFor("admin", { ...filters, activeReportId: "dead-stock" })),
    );

    expect(deadStock.query("dead-stock")).toMatchObject({ categoryId: "cat-1", days: "90" });

    const turnover = installApi();

    await fetchReportsForExport(
      storeFilters(viewFor("admin", { ...filters, activeReportId: "stock-turnover" })),
    );

    expect(turnover.query("stock-turnover")).toMatchObject({ ...range, groupBy: "category" });
  });

  it("abierto sin moneda en la URL, el cierre de caja exporta Bs, como la pantalla", async () => {
    const api = installApi();

    await fetchReportsForExport(
      storeFilters(viewFor("admin", { activeReportId: "cash-close-differences" })),
    );

    expect(api.query("cash-close-differences")).toMatchObject({ currency: "ves" });
  });

  it("sin rango completo no pide las rutas que lo exigen: sus hojas salen vacías", async () => {
    const api = installApi();

    const data = await fetchReportsForExport({
      dateFilters: { from: "2026-09-01" },
      purchasesFilters: {},
      stockCardFilters: {},
      view: viewFor("admin"),
    });
    const paths = api.paths();

    for (const slug of ["sales-by-hour", "sales-by-category", "stock-turnover", "stock-adjustments"]) {
      expect(paths).not.toContain(`/api/reports/${slug}`);
    }

    expect(data.salesByHour).toEqual([]);
    expect(data.salesByCategory).toEqual([]);
    expect(data.stockTurnover).toEqual([]);
    expect(data.stockAdjustments).toEqual([]);
    expect(paths).toContain("/api/reports/cash-close-differences");
  });

  it("ventas por hora sale como filas día × hora, solo con las celdas que tuvieron ventas", async () => {
    installApi();

    const data = await fetchReportsForExport(storeFilters(viewFor("admin")));

    expect(data.salesByHour).toEqual([
      { hour: 9, salesCount: 2, totalRef: 30, totalVes: 1095, weekday: "martes" },
      { hour: 18, salesCount: 1, totalRef: 12, totalVes: 438, weekday: "domingo" },
    ]);
  });

  it("pide el kardex solo con producto", async () => {
    const api = installApi({ "stock-card": [{ id: "m1", productId: "p1" }] });

    const data = await fetchReportsForExport({
      ...storeFilters(viewFor("admin")),
      stockCardFilters: { productId: " p1 " },
    });

    expect(api.query("stock-card")).toMatchObject({ productId: "p1" });
    expect(data.stockCard).toEqual([{ id: "m1", productId: "p1" }]);
  });

  it("pagina hasta el total sin repetir documentos de las listas paginadas", async () => {
    const receivables = Array.from({ length: 230 }, (_, index) => ({
      document: { id: `sale-${index}` },
    }));
    const closes = Array.from({ length: 120 }, (_, index) => ({
      cashSessionId: `s-${Math.floor(index / 2)}`,
      currency: index % 2 === 0 ? "ves" : "ref",
    }));

    installApi({ "cash-close-differences": closes, "receivables-aging": receivables });

    const data = await fetchReportsForExport(storeFilters(viewFor("admin")));

    expect(data.receivablesAging).toHaveLength(230);
    // Una sesión con dos monedas son dos filas distintas.
    expect(data.cashCloseDifferences).toHaveLength(120);
  });

  it("descarta la fila que se repite al desplazarse la paginación", async () => {
    const sales = Array.from({ length: 150 }, (_, index) => ({ saleDate: `d${index}`, storeId: "s1" }));
    let dailySalesRequests = 0;

    installApi({ "daily-sales": sales });
    const routed = global.fetch as jest.Mock;
    const serve = routed.getMockImplementation() as typeof fetch;

    routed.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/daily-sales")) {
        dailySalesRequests += 1;

        if (dailySalesRequests === 2) {
          sales.unshift({ saleDate: "nuevo", storeId: "s1" });
        }
      }

      return serve(input);
    });

    const data = await fetchReportsForExport(storeFilters());
    const keys = data.dailySales.map((row) => row.saleDate);

    expect(keys).toHaveLength(150);
    expect(new Set(keys).size).toBe(150);
  });

  it("dos tiendas con el mismo día son dos filas (plataforma)", async () => {
    installApi({
      "daily-sales": [
        { saleDate: "2026-09-01", storeId: "s1" },
        { saleDate: "2026-09-01", storeId: "s2" },
      ],
      "payment-methods": [
        { amountRef: 10, method: "pago_movil" },
        { amountRef: 12, method: "pago_movil" },
      ],
    });

    const data = await fetchReportsForExport({
      ...storeFilters(),
      scope: { pathPrefix: "/api/platform/reports" },
    });

    expect(data.dailySales).toHaveLength(2);
    expect(data.paymentMethods).toHaveLength(2);
  });

  it("corta una lista en 20.000 filas y lo anota para avisar al usuario", async () => {
    const purchases = Array.from({ length: 20_150 }, (_, index) => ({ id: `p-${index}` }));

    installApi({ purchases });

    const data = await fetchReportsForExport(storeFilters());

    expect(data.purchases).toHaveLength(20_000);
    expect(data.truncated).toEqual({ purchases: { exported: 20_000, total: 20_150 } });
  });

  it("conserva las cifras del cierre del día y la nota de depreciación FX", async () => {
    installApi({ "fx-depreciation": [{ saleId: "s1", storeId: null }] });

    const data = await fetchReportsForExport(storeFilters());

    expect(data.dailyClose).toEqual([
      { metric: "Ventas", value: 3 },
      { metric: "Total REF", value: 100 },
      { metric: "Total VES", value: 3650 },
      { metric: "Pagos activos", value: 4 },
      { metric: "Cobros REF", value: 90 },
      { metric: "Pérdida FX REF", value: 2.5 },
      { metric: "Capital REF hoy", value: 80 },
      { metric: "Baúl REF", value: 40 },
      { metric: "Caja teórica REF", value: "N/D" },
    ]);
    expect(data.fxDepreciation).toEqual([{ saleId: "s1", storeId: null }]);
    expect(data.fxDepreciationNote).toBe(
      "Tasa valorización 36.5; capital hoy REF 80; pérdida VES REF 2.5 (3.1%).",
    );
  });

  it("si no se puede leer la configuración, exporta sin el nombre de la tienda", async () => {
    installApi({}, { forbidden: ["settings"] });

    const data = await fetchReportsForExport(storeFilters(viewFor("admin")));

    expect(data.storeName).toBeUndefined();
    expect(data.dailyClose).toHaveLength(9);
  });
});
