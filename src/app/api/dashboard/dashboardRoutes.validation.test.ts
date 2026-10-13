/**
 * @jest-environment node
 */

import { GET as dailyClose } from "./daily-close/route";
import { GET as metrics } from "./metrics/route";
import { GET as salesTrend } from "./sales-trend/route";

/**
 * REP-F7 (R-01, R-09, R-12): las rutas del dashboard que aceptan fechas usan
 * el mismo validador que Reportes. `sales-trend?to=9999-12-31` colgaba el
 * proceso (también con `fromStart`).
 */

type RouteHandler = (request: Request) => Promise<Response>;

const ROUTES: Array<[string, RouteHandler]> = [
  ["daily-close", dailyClose],
  ["metrics", metrics],
  ["sales-trend", salesTrend],
];

const TEN_KB = "9".repeat(10_240);

function call(handler: RouteHandler, name: string, query: string) {
  return handler(
    new Request(`http://localhost/api/dashboard/${name}?${query}`, {
      headers: { "x-demo-role": "admin" },
    }),
  );
}

describe.each(ROUTES)("/api/dashboard/%s: fechas", (name, handler) => {
  it.each([
    ["from=2026-05-01&to=9999-12-31&compare=1", /"hasta" no es válida.*año/],
    ["fromStart=1&to=9999-12-31", /"hasta" no es válida.*año/],
    ["from=9999-12-01&to=9999-12-31", /"desde" no es válida.*año/],
    ["from=1999-12-31&to=2026-05-18", /"desde" no es válida.*año/],
    ["from=abc&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-02-30&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    [`from=${TEN_KB}&to=2026-05-18`, /"desde" no es válida/],
    ["date=abc", /"día" no es válida/],
  ])("400 en español con %s", async (query, message) => {
    const response = await call(handler, name, query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
  });

  it.each([
    "",
    "from=&to=",
    "from=2026-05-01&to=2026-05-18",
    "to=2026-05-18",
    // Con `fromStart` el `from` se ignora, igual que en los servicios.
    "fromStart=1&from=abc&to=2026-05-18",
  ])("responde 200 con «%s»", async (query) => {
    expect((await call(handler, name, query)).status).toBe(200);
  });
});
