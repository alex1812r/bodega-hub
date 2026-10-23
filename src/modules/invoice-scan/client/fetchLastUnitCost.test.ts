/**
 * REP9-01 (D41-a/D42) · cliente de `GET /api/purchases/invoice-scan/last-unit-costs`: el último
 * costo por unidad REF de un producto elegido fuera de los candidatos, o null si no se conoce.
 */
import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import { fetchLastUnitCostRef } from "./fetchLastUnitCost";

function installApi(data: unknown) {
  const urls: URL[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    urls.push(new URL(String(input), "http://localhost"));
    return jsonResponse({ data });
  }) as typeof fetch;
  return urls;
}

describe("fetchLastUnitCostRef", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("pide solo ids (producto y proveedor) y devuelve el costo del producto", async () => {
    const urls = installApi([{ productId: "p-1", lastUnitCostRef: 0.84 }]);

    await expect(fetchLastUnitCostRef("p-1", "sup-1")).resolves.toBe(0.84);
    expect(urls).toHaveLength(1);
    expect(urls[0].pathname).toBe("/api/purchases/invoice-scan/last-unit-costs");
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ productIds: "p-1", supplierId: "sup-1" });
  });

  it("sin proveedor no manda supplierId", async () => {
    const urls = installApi([{ productId: "p-1", lastUnitCostRef: 2 }]);

    await expect(fetchLastUnitCostRef("p-1")).resolves.toBe(2);
    expect(urls[0].searchParams.has("supplierId")).toBe(false);
  });

  it("sin último costo conocido devuelve null", async () => {
    installApi([{ productId: "p-1", lastUnitCostRef: null }]);

    await expect(fetchLastUnitCostRef("p-1")).resolves.toBeNull();
  });

  it("si la respuesta no trae el producto devuelve null", async () => {
    installApi([]);

    await expect(fetchLastUnitCostRef("p-1")).resolves.toBeNull();
  });
});
