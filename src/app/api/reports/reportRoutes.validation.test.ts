/**
 * @jest-environment node
 */

import { GET as cashCloseDifferences } from "./cash-close-differences/route";
import { GET as customerPurchases } from "./customer-purchases/route";
import { GET as dailyClose } from "./daily-close/route";
import { GET as dailySales } from "./daily-sales/route";
import { GET as fxDepreciation } from "./fx-depreciation/route";
import { GET as grossProfit } from "./gross-profit/route";
import { GET as paymentMethods } from "./payment-methods/route";
import { GET as productProfitability } from "./product-profitability/route";
import { GET as purchases } from "./purchases/route";
import { GET as salesByCategory } from "./sales-by-category/route";
import { GET as salesByHour } from "./sales-by-hour/route";
import { GET as stockAdjustments } from "./stock-adjustments/route";
import { GET as stockCard } from "./stock-card/route";
import { GET as stockTurnover } from "./stock-turnover/route";
import { GET as supplierPurchases } from "./supplier-purchases/route";
import { GET as topCustomers } from "./top-customers/route";
import { GET as topProducts } from "./top-products/route";

/**
 * REP-F7 (R-01, R-09, R-12): todas las rutas de reportes que aceptan fechas
 * pasan por el mismo validador. Antes, `to=9999-12-31` colgaba el proceso en
 * las rutas con serie y las rutas antiguas aceptaban cualquier texto.
 */

type RouteHandler = (request: Request) => Promise<Response>;

const DATE_ROUTES: Array<[string, RouteHandler]> = [
  ["cash-close-differences", cashCloseDifferences],
  ["customer-purchases", customerPurchases],
  ["daily-close", dailyClose],
  ["daily-sales", dailySales],
  ["fx-depreciation", fxDepreciation],
  ["gross-profit", grossProfit],
  ["payment-methods", paymentMethods],
  ["product-profitability", productProfitability],
  ["purchases", purchases],
  ["sales-by-category", salesByCategory],
  ["sales-by-hour", salesByHour],
  ["stock-adjustments", stockAdjustments],
  ["stock-card", stockCard],
  ["stock-turnover", stockTurnover],
  ["supplier-purchases", supplierPurchases],
  ["top-customers", topCustomers],
  ["top-products", topProducts],
];

/** Rutas antiguas: sin parámetros responden como siempre. */
const OPTIONAL_DATE_ROUTES: Array<[string, RouteHandler]> = [
  ["customer-purchases", customerPurchases],
  ["daily-close", dailyClose],
  ["fx-depreciation", fxDepreciation],
  ["product-profitability", productProfitability],
  ["purchases", purchases],
  ["stock-card", stockCard],
  ["supplier-purchases", supplierPurchases],
  ["top-customers", topCustomers],
  ["top-products", topProducts],
];

const TEN_KB = "9".repeat(10_240);

function call(handler: RouteHandler, name: string, query: string) {
  return handler(
    new Request(`http://localhost/api/reports/${name}?${query}`, {
      headers: { "x-demo-role": "admin" },
    }),
  );
}

async function expectBadRequest(response: Response, message: RegExp) {
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error.code).toBe("BAD_REQUEST");
  expect(body.error.message).toMatch(message);
}

describe.each(DATE_ROUTES)("/api/reports/%s: fechas", (name, handler) => {
  it.each([
    ["from=2026-05-01&to=9999-12-31&groupBy=day&compare=1", /"hasta" no es válida.*año/],
    ["from=9999-12-01&to=9999-12-31&groupBy=month", /"desde" no es válida.*año/],
    ["from=1999-12-31&to=2026-05-18", /"desde" no es válida.*año/],
    ["from=abc&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-02-30&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-05-01&to=2026-5-18", /"hasta" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    [`from=${TEN_KB}&to=2026-05-18`, /"desde" no es válida/],
  ])("400 en español con %s", async (query, message) => {
    await expectBadRequest(await call(handler, name, query), message);
  });

  it("acepta un rango válido", async () => {
    const response = await call(handler, name, "from=2026-05-01&to=2026-05-18");

    expect(response.status).toBe(200);
  });
});

describe.each(OPTIONAL_DATE_ROUTES)("/api/reports/%s: parámetros ausentes", (name, handler) => {
  it.each(["", "from=&to=", "from=2026-05-01", "to=2026-05-18"])(
    "responde 200 con «%s»",
    async (query) => {
      expect((await call(handler, name, query)).status).toBe(200);
    },
  );
});

describe("/api/reports/daily-close: date", () => {
  it.each(["date=abc", "date=2026-02-30", "date=9999-12-31"])("400 con %s", async (query) => {
    await expectBadRequest(await call(dailyClose, "daily-close", query), /"día" no es válida/);
  });
});

describe("identificadores por la URL", () => {
  it.each<[string, RouteHandler, string, RegExp]>([
    ["stock-card", stockCard, `productId=${TEN_KB}`, /El producto no es válido/],
    ["stock-card", stockCard, "productId=a%20b", /El producto no es válido/],
    ["stock-card", stockCard, "productId=eq.1,or(id.gt.0)", /El producto no es válido/],
    ["purchases", purchases, `supplierId=${TEN_KB}`, /El proveedor no es válido/],
  ])("/api/reports/%s responde 400 con un id sin forma de id", async (name, handler, query, message) => {
    await expectBadRequest(await call(handler, name, query), message);
  });

  it.each<[string, RouteHandler, string]>([
    ["stock-card", stockCard, "productId=prod-cable"],
    ["stock-card", stockCard, "productId=3f0e8a52-6f0b-4c61-9d7e-0f6f5b1f2a10"],
    ["stock-card", stockCard, "productId="],
    ["purchases", purchases, "supplierId=3f0e8a52-6f0b-4c61-9d7e-0f6f5b1f2a10"],
  ])("/api/reports/%s acepta %s", async (name, handler, query) => {
    expect((await call(handler, name, query)).status).toBe(200);
  });
});
