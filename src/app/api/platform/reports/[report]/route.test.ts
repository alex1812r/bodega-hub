/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/reports/[report]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns daily sales for all stores as superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/reports/daily-sales?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ report: "daily-sales" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ items: expect.any(Array) }),
      }),
    );
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/reports/daily-sales?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
      { params: Promise.resolve({ report: "daily-sales" }) },
    );

    expect(response.status).toBe(403);
  });

  it("requires a store when scope is one", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/reports/low-stock?storeScope=one", {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ report: "low-stock" }) },
    );

    expect(response.status).toBe(400);
  });

  it("filters by a single store", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/platform/reports/low-stock?storeScope=one&storeIds=00000000-0000-4000-8000-000000000001",
        { headers: { "x-demo-role": "superadmin" } },
      ),
      { params: Promise.resolve({ report: "low-stock" }) },
    );

    expect(response.status).toBe(200);
  });

  // INT-05 (B3): el mismo validador de fechas e ids que las rutas de tienda (REP-F7).
  function call(report: string, query: string) {
    return GET(
      new Request(`http://localhost/api/platform/reports/${report}?storeScope=all&${query}`, {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ report }) },
    );
  }

  async function expectBadRequest(response: Response, message: RegExp) {
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
  }

  describe.each([
    "customer-purchases",
    "daily-close",
    "daily-sales",
    "fx-depreciation",
    "gross-profit",
    "payment-methods",
    "product-profitability",
    "purchases",
    "stock-card",
    "supplier-purchases",
    "top-customers",
    "top-products",
  ])("%s: fechas", (report) => {
    it.each([
      ["from=2026-05-01&to=9999-12-31&groupBy=day&compare=1", /"hasta" no es válida.*año/],
      ["from=9999-12-01&to=9999-12-31&groupBy=month", /"desde" no es válida.*año/],
      ["from=1999-12-31&to=2026-05-18", /"desde" no es válida.*año/],
      ["from=abc&to=2026-05-18", /"desde" no es válida/],
      ["from=2026-02-30&to=2026-05-18", /"desde" no es válida/],
      ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
      ["from=%202026-05-01&to=2026-05-18", /"desde" no es válida/],
    ])("400 en español con %s", async (query, message) => {
      await expectBadRequest(await call(report, query), message);
    });

    it.each(["from=2026-05-01&to=2026-05-18", "", "from=&to="])("200 con «%s»", async (query) => {
      expect((await call(report, query)).status).toBe(200);
    });
  });

  it("low-stock no usa fechas: las ignora como la ruta de tienda", async () => {
    expect((await call("low-stock", "from=9999-12-31")).status).toBe(200);
  });

  it.each([
    ["stock-card", "productId=eq.1,or(id.gt.0)", /El producto no es válido/],
    ["stock-card", `productId=${"9".repeat(10_240)}`, /El producto no es válido/],
    ["purchases", "supplierId=a%20b", /El proveedor no es válido/],
  ])("%s responde 400 con un id sin forma de id (%s)", async (report, query, message) => {
    await expectBadRequest(await call(report, query), message);
  });

  it("daily-close valida también `date`", async () => {
    await expectBadRequest(await call("daily-close", "date=9999-12-31"), /"día" no es válida/);
  });
});
