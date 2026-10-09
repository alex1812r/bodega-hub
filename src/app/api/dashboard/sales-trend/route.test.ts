/**
 * @jest-environment node
 */

import { GET } from "./route";

function get(query: string, role: string) {
  return GET(
    new Request(`http://localhost/api/dashboard/sales-trend${query}`, {
      headers: { "x-demo-role": role },
    }),
  );
}

describe("/api/dashboard/sales-trend", () => {
  it("returns sales trend for dashboard viewer", async () => {
    const response = await get("?from=2026-05-01&to=2026-05-18", "admin");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.series.groupBy).toBe("day");
    expect(body.data.series.current).toHaveLength(18);
    expect(body.data.series.previous).toBeNull();
  });

  it("con compare=1 trae el periodo anterior alineado y nunca NaN en el delta", async () => {
    const response = await get("?from=2026-05-12&to=2026-05-18&compare=1", "admin");
    const { series } = (await response.json()).data;

    expect(series.previousRange).toEqual({ from: "2026-05-05", to: "2026-05-11" });
    expect(series.previous).toHaveLength(series.current.length);
    expect(series.totals.deltaPct === null || Number.isFinite(series.totals.deltaPct)).toBe(true);
  });

  // La serie sale del servicio de Reportes, pero el permiso sigue siendo el del dashboard.
  it.each(["almacen", "vendedor", "contador"])(
    "%s (dashboard.view, con o sin reports.view) ve el gráfico",
    async (role) => {
      const response = await get("?from=2026-05-12&to=2026-05-18&compare=1", role);

      expect(response.status).toBe(200);
      expect((await response.json()).data.series.current).toHaveLength(7);
    },
  );

  it("sin rango responde sin serie", async () => {
    const response = await get("", "admin");

    expect(response.status).toBe(200);
    expect((await response.json()).data.series).toBeNull();
  });

  it("rechaza una fecha mal formada con 400", async () => {
    const response = await get("?from=18-05-2026&to=2026-05-18", "admin");

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
  });

  it("rechaza al superadmin de plataforma, que no tiene dashboard.view", async () => {
    const response = await get("?from=2026-05-12&to=2026-05-18", "superadmin");

    expect(response.status).toBe(403);
  });
});
