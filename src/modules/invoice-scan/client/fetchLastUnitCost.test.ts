/**
 * REP9-01 (D41-a/D42) · cliente de `GET /api/purchases/invoice-scan/last-unit-costs`: el último
 * costo por unidad REF de un producto elegido fuera de los candidatos, o null si no se conoce.
 */
import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import { fetchLastUnitCostRef, LAST_UNIT_COST_TIMEOUT_MS } from "./fetchLastUnitCost";

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
  describe("REP10-02 (B2): tope de tiempo y un reintento", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    /** fetch que no responde nunca: solo termina si se aborta su señal. */
    function hangingFetch() {
      return jest.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      );
    }

    it("si no responde, rechaza tras el tope y un reintento", async () => {
      jest.useFakeTimers();
      const fetchMock = hangingFetch();
      global.fetch = fetchMock as typeof fetch;

      const result = fetchLastUnitCostRef("p-1");
      const settled = jest.fn();
      result.then(settled, settled);

      await jest.advanceTimersByTimeAsync(LAST_UNIT_COST_TIMEOUT_MS);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(settled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(LAST_UNIT_COST_TIMEOUT_MS);
      await expect(result).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("si falla una vez y luego responde, devuelve el valor", async () => {
      const fetchMock = jest
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(jsonResponse({ data: [{ productId: "p-1", lastUnitCostRef: 0.84 }] }));
      global.fetch = fetchMock as typeof fetch;

      await expect(fetchLastUnitCostRef("p-1")).resolves.toBe(0.84);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("si falla dos veces, rechaza (camino de fallo de D42)", async () => {
      const fetchMock = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      global.fetch = fetchMock as typeof fetch;

      await expect(fetchLastUnitCostRef("p-1")).rejects.toThrow("Failed to fetch");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("un rechazo del servidor por la petición (4xx) no se reintenta", async () => {
      const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ error: { code: "FORBIDDEN", message: "No" } }, 403));
      global.fetch = fetchMock as typeof fetch;

      await expect(fetchLastUnitCostRef("p-1")).rejects.toThrow("No");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
