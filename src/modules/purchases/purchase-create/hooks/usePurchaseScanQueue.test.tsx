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
