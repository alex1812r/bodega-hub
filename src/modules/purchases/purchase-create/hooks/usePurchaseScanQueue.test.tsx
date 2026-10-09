import { act, renderHook, waitFor } from "@testing-library/react";

import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import { readPurchaseLineScan } from "../utils/purchaseLineScan";
import { usePurchaseScanQueue, type PurchaseScanOutcome } from "./usePurchaseScanQueue";

const CODE = "1111111111116";

/** Ningún producto tiene ningún código: cada consulta responde una lista vacía. */
function installEmptyCatalog() {
  const fetchMock = jest.fn(async (url: RequestInfo | URL) =>
    jsonResponse({ data: { items: [], limit: 2, skip: 0, total: 0, url: String(url) } }),
  );

  global.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
}

/** Instantes de tecla: lo tecleado a mano (300 ms) y luego la ráfaga del lector (4 ms). */
function stampsFor(typed: string, code: string) {
  let now = 1_000_000;
  const stamps = [
    ...typed.replace(".", "").split("").map(() => (now += 300)),
    ...code.split("").map((_, index) => (now += index === 0 ? 400 : 4)),
  ];

  return { now: now + 4, stamps };
}

async function scanInCell(typed: string, code: string) {
  const fetchMock = installEmptyCatalog();
  const settled: PurchaseScanOutcome[] = [];
  const { result } = renderHook(() =>
    usePurchaseScanQueue("cont-supplier", (outcome) => settled.push(outcome)),
  );
  const { now, stamps } = stampsFor(typed, code);
  const scan = readPurchaseLineScan(`${typed}${code}`, stamps, now);

  act(() => result.current.enqueue({ codes: scan?.candidates ?? [] }));
  await waitFor(() => expect(settled).toHaveLength(1));

  return { fetchMock, settled };
}

// COM-F10 · F-A2: un código inexistente leído en una celda costaba 6 u 8 consultas.
describe("usePurchaseScanQueue · consultas por un código inexistente leído en una celda (COM-F10 · F-A2)", () => {
  it.each([
    ["la celda vacía", ""],
    ["«4» tecleado delante", "4"],
    ["«55.5» tecleado delante", "55.5"],
  ])("con %s: como mucho 4 peticiones, y avisa de que no existe", async (_case, typed) => {
    const { fetchMock, settled } = await scanInCell(typed, CODE);

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(settled[0]?.resolution).toEqual({ status: "not_found" });
  });

  it("las peticiones son el código de 13 dígitos y su sufijo de 12, cada uno por código de barras y por SKU", async () => {
    const { fetchMock } = await scanInCell("4", CODE);
    const queries = fetchMock.mock.calls.map(([url]) => {
      const params = new URL(String(url), "http://localhost").searchParams;

      return `${params.has("barcode") ? "barcode" : "sku"}=${params.get("barcode") ?? params.get("sku")}`;
    });

    expect(queries).toEqual([
      `barcode=${CODE}`,
      `sku=${CODE}`,
      `barcode=${CODE.slice(1)}`,
      `sku=${CODE.slice(1)}`,
    ]);
  });
});

// COM-F11 · un producto elegido en la lista antes de saber su último costo espera en la cola.
describe("usePurchaseScanQueue · producto elegido sin su último costo (COM-F11)", () => {
  const picked = {
    costWithTaxRef: 2494.41,
    currentStock: 1,
    lastCostPending: true,
    link: "none" as const,
    name: "Taladro",
    packUnits: [],
    productId: "prod-drill",
    sku: "ELE-TAL-001",
    taxRate: 16,
    unitCostRef: 2150.35,
  };

  function renderQueue() {
    const settled: PurchaseScanOutcome[] = [];
    const { result } = renderHook(() =>
      usePurchaseScanQueue("cont-supplier", (outcome) => settled.push(outcome)),
    );

    return { result, settled };
  }

  it("consulta solo su último costo (sin buscar por código) y lo entrega con el neto recibido", async () => {
    const fetchMock = jest.fn(async (url: RequestInfo | URL) =>
      jsonResponse({
        data: [{ productId: "prod-drill", source: "supplier", taxRate: 0, unitCostRef: 2494.41 }],
        url: String(url),
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result, settled } = renderQueue();

    act(() => result.current.enqueue({ codes: [], picked }));
    await waitFor(() => expect(settled).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/purchases/last-costs?");
    expect(settled[0]?.resolution).toMatchObject({
      product: { lastPurchaseUnitCostRef: 2494.41, productId: "prod-drill", unitCostRef: 2494.41 },
      status: "found",
    });
    expect(settled[0]?.resolution).not.toHaveProperty("product.lastCostPending");
  });

  it("si la consulta falla, el producto no entra con un costo provisional", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const { result, settled } = renderQueue();

    act(() => result.current.enqueue({ codes: [], picked }));
    await waitFor(() => expect(settled).toHaveLength(1));

    expect(settled[0]?.resolution).toEqual({ status: "failed" });
  });
});
