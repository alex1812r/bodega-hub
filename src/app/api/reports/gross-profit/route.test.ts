/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/reports/gross-profit", () => {
  it("returns gross profit report", async () => {
    const response = await GET(
      new Request("http://localhost/api/reports/gross-profit", {
        headers: { "x-demo-role": "contador" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toEqual(expect.objectContaining({ grossProfitRef: expect.any(Number) }));
  });
});

describe("/api/reports/gross-profit: validación de parámetros (REP-05)", () => {
  function get(query: string) {
    return GET(
      new Request(`http://localhost/api/reports/gross-profit?${query}`, {
        headers: { "x-demo-role": "contador" },
      }),
    );
  }

  it.each([
    ["from=2026-13-40", /"desde" no es válida/],
    ["to=ayer", /"hasta" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
    ["from=2026-05-01&to=2026-05-31&groupBy=anual", /agrupación no es válida/],
  ])("responde 400 en español con %s", async (query, message) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toMatch(message);
  });

  it("acepta un rango válido con groupBy y compare", async () => {
    const response = await get("from=2026-05-01&to=2026-05-31&groupBy=week&compare=1");

    expect(response.status).toBe(200);
  });
});
