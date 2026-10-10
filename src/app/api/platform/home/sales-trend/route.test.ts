/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/home/sales-trend", () => {
  it("returns sales trend for superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/sales-trend?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("rejects store admin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/sales-trend?storeScope=all", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });

  // POS-H2 (D60): el mismo validador de fechas que las rutas hermanas (INT-05, REP-F7).
  it.each([
    ["from=2026-05-01&to=9999-12-31", /"hasta" no es válida.*año/],
    ["from=1999-12-31&to=2026-05-18", /"desde" no es válida.*año/],
    ["from=abc&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-02-30&to=2026-05-18", /"desde" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2026-05-01&to=2026-05-18%0a", /"hasta" no es válida/],
    ["to=no-es-fecha", /"hasta" no es válida/],
  ])("400 en español con %s", async (query, message) => {
    const response = await GET(
      new Request(`http://localhost/api/platform/home/sales-trend?storeScope=all&${query}`, {
        headers: { "x-demo-role": "superadmin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
  });

  it("rechaza al admin de tienda con 403 antes de validar las fechas", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/sales-trend?storeScope=all&from=abc", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it.each([
    "from=2026-05-01&to=2026-05-18",
    "from=9999-12-31&fromStart=1&to=2026-05-18",
    "from=&to=",
    "from=2026-05-01",
  ])("200 con «%s»", async (query) => {
    const response = await GET(
      new Request(`http://localhost/api/platform/home/sales-trend?storeScope=all&${query}`, {
        headers: { "x-demo-role": "superadmin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("sin fechas responde como antes: los días con ventas y sin serie", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/home/sales-trend?storeScope=all", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.series).toBeNull();
  });
});
