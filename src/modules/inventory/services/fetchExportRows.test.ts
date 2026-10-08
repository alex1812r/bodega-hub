/**
 * @jest-environment node
 */

import { EXPORT_MAX_ROWS, fetchExportRows, formatExportCount } from "./fetchExportRows";

type Row = { id: string };

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

/**
 * BFF de prueba sobre una lista viva ordenada del más nuevo al más viejo.
 * `beforeRequest(n)` corre antes de servir la petición n (1 = la primera).
 */
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

function rows(count: number, prefix = "mov"): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${count - index}` }));
}

describe("fetchExportRows (INV-F5 · M2)", () => {
  it("no repite filas cuando entran movimientos nuevos durante la exportación", async () => {
    const list = rows(250);

    // Tras la primera página entran 3 movimientos: todo se desplaza 3 puestos.
    installListApi(list, (request) => {
      if (request === 2) {
        list.unshift({ id: "nuevo-3" }, { id: "nuevo-2" }, { id: "nuevo-1" });
      }
    });

    const result = await fetchExportRows<Row>("/api/inventory/movements");
    const ids = result.rows.map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
    // Todas las filas que existían al empezar, en su orden.
    expect(ids).toEqual(rows(250).map((row) => row.id));
    expect(result.truncated).toBe(false);
  });

  it("pide páginas con el límite máximo del BFF y los filtros recibidos", async () => {
    const urls = installListApi(rows(150));

    await fetchExportRows<Row>("/api/inventory/movements", { productId: "prod-cable" });

    expect(urls).toEqual([
      "/api/inventory/movements?productId=prod-cable&limit=100&skip=0",
      "/api/inventory/movements?productId=prod-cable&limit=100&skip=100",
    ]);
  });

  it("corta en el tope y lo declara, sin pedir más páginas de las necesarias", async () => {
    const urls = installListApi(rows(1_000));

    const result = await fetchExportRows<Row>("/api/inventory/movements", {}, 250);

    expect(result.rows).toHaveLength(250);
    expect(result.rows[0].id).toBe("mov-1000");
    expect(result).toMatchObject({ total: 1_000, truncated: true });
    expect(urls).toHaveLength(3);
  });

  it("una lista del tamaño exacto del tope no se declara cortada", async () => {
    installListApi(rows(200));

    const result = await fetchExportRows<Row>("/api/inventory/movements", {}, 200);

    expect(result).toMatchObject({ total: 200, truncated: false });
    expect(result.rows).toHaveLength(200);
  });

  it("una lista vacía devuelve cero filas con una sola petición", async () => {
    const urls = installListApi([]);

    await expect(fetchExportRows<Row>("/api/inventory")).resolves.toEqual({
      rows: [],
      total: 0,
      truncated: false,
    });
    expect(urls).toHaveLength(1);
  });

  it("el tope por defecto es de 20.000 filas", () => {
    expect(EXPORT_MAX_ROWS).toBe(20_000);
    expect(formatExportCount(EXPORT_MAX_ROWS)).toBe("20.000");
    expect(formatExportCount(1_234_567)).toBe("1.234.567");
    expect(formatExportCount(999)).toBe("999");
  });
});
