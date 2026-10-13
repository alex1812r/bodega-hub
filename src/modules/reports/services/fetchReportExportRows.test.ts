/**
 * @jest-environment node
 */

import { EXPORT_MAX_ROWS } from "@/modules/inventory/services/fetchExportRows";

import { fetchKeyedExportRows } from "./fetchReportExportRows";

type Row = { saleDate: string; total: number };

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

/** BFF de prueba sobre una lista viva; `beforeRequest(n)` corre antes de servir la petición n. */
function installListApi(list: Row[], beforeRequest: (request: number) => void = () => undefined) {
  const urls: string[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");

    urls.push(String(input));
    beforeRequest(urls.length);

    const skip = Number(url.searchParams.get("skip"));
    const limit = Number(url.searchParams.get("limit"));

    return jsonResponse({
      data: { items: list.slice(skip, skip + limit), limit, skip, total: list.length },
    });
  }) as unknown as typeof fetch;

  return urls;
}

function days(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ saleDate: `d${index}`, total: index }));
}

const byDay = (row: Row) => row.saleDate;

describe("fetchKeyedExportRows (REP-08)", () => {
  it("no repite filas cuando entra una nueva por delante durante la exportación", async () => {
    const list = days(250);

    installListApi(list, (request) => {
      if (request === 2) {
        list.unshift({ saleDate: "nuevo", total: 1 });
      }
    });

    const result = await fetchKeyedExportRows<Row>("/api/reports/daily-sales", {}, byDay);
    const keys = result.rows.map(byDay);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(days(250).map(byDay));
    expect(result.truncated).toBe(false);
  });

  it("pide páginas de 100 con los filtros recibidos y avanza por lo leído", async () => {
    const urls = installListApi(days(150));

    await fetchKeyedExportRows<Row>(
      "/api/reports/daily-sales",
      { from: "2026-09-01", to: undefined },
      byDay,
    );

    expect(urls).toEqual([
      "/api/reports/daily-sales?from=2026-09-01&limit=100&skip=0",
      "/api/reports/daily-sales?from=2026-09-01&limit=100&skip=100",
    ]);
  });

  it("corta en el tope y lo declara, sin pedir más páginas", async () => {
    const urls = installListApi(days(450));

    const result = await fetchKeyedExportRows<Row>("/api/reports/daily-sales", {}, byDay, 200);

    expect(result.rows).toHaveLength(200);
    expect(result).toMatchObject({ total: 450, truncated: true });
    expect(urls).toHaveLength(2);
  });

  it("una lista del tamaño exacto del tope no se declara cortada", async () => {
    installListApi(days(200));

    const result = await fetchKeyedExportRows<Row>("/api/reports/daily-sales", {}, byDay, 200);

    expect(result).toMatchObject({ total: 200, truncated: false });
    expect(result.rows).toHaveLength(200);
  });

  it("una lista vacía devuelve cero filas con una sola petición", async () => {
    const urls = installListApi([]);

    await expect(fetchKeyedExportRows<Row>("/api/reports/daily-sales", {}, byDay)).resolves.toEqual({
      rows: [],
      total: 0,
      truncated: false,
    });
    expect(urls).toHaveLength(1);
  });

  it("usa el mismo tope que las exportaciones de Inventario", async () => {
    installListApi(days(3));

    expect(EXPORT_MAX_ROWS).toBe(20_000);
    await expect(
      fetchKeyedExportRows<Row>("/api/reports/daily-sales", {}, byDay),
    ).resolves.toMatchObject({ truncated: false });
  });
});
