/**
 * @jest-environment node
 */

import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import { createProduct, getProductById } from "@/modules/products/services/products.mock-server";
import { mockProductPriceHistory, mockPurchases } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET as getQueue } from "../route";
import { POST } from "./route";

function post(body: unknown, role = "admin") {
  return POST(
    new Request("http://localhost/api/products/price-review/reprice", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
  );
}

let seq = 0;

function newProduct(costRef: number, priceRef: number) {
  seq += 1;

  return createProduct(
    { currentCostRef: costRef, name: `Reprecio ${seq}`, salePriceRef: priceRef, sku: `rev-reprice-${seq}` },
    DEFAULT_STORE_ID,
  ).id;
}

/** Filas de historial de cada producto, en el orden de `ids`. */
function historyRows(ids: string[]) {
  return ids.map((id) => mockProductPriceHistory.filter((entry) => entry.productId === id).length);
}

async function queuedIds() {
  const response = await getQueue(new Request("http://localhost/api/products/price-review?limit=100"));
  const body = await response.json();

  return (body.data.items as { productId: string }[]).map((item) => item.productId);
}

describe("/api/products/price-review/reprice", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("reprices the selection at the given % and takes the products out of the queue", async () => {
    const ids = [newProduct(8, 10), newProduct(8, 10)];
    for (const id of ids) applyMockPurchaseCost(id, 9, mockPurchases[0].id);
    expect(await queuedIds()).toEqual(expect.arrayContaining(ids));

    const response = await post({ markupPct: 25, productIds: ids }, "almacen");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      failed: 0,
      results: ids.map((productId) => ({ productId, salePriceRef: 11.25, status: "ok" })),
      updated: 2,
    });
    expect(getProductById(ids[0], DEFAULT_STORE_ID).salePriceRef).toBe(11.25);
    expect((await queuedIds()).filter((id) => ids.includes(id))).toEqual([]);
  });

  it("answers 200 with a per-product error for a product without cost, and never sets price 0", async () => {
    const ok = newProduct(9, 10);
    const noCost = newProduct(0, 4);

    const response = await post({ markupPct: 20, productIds: [noCost, ok], reason: "  Ajuste  " });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      failed: 1,
      results: [
        { code: "NO_COST", message: expect.any(String), productId: noCost, status: "error" },
        { productId: ok, salePriceRef: 10.8, status: "ok" },
      ],
      updated: 1,
    });
    expect(getProductById(noCost, DEFAULT_STORE_ID).salePriceRef).toBe(4);
  });

  it.each([
    ["sin productos", { markupPct: 25, productIds: [] }],
    ["más de 100 productos", { markupPct: 25, productIds: Array.from({ length: 101 }, (_, index) => `p-${index}`) }],
    ["sin %", { productIds: ["prod-drill"] }],
    ["% 0", { markupPct: 0, productIds: ["prod-drill"] }],
    ["% negativo", { markupPct: -5, productIds: ["prod-drill"] }],
    ["% por encima del tope", { markupPct: 1000.01, productIds: ["prod-drill"] }],
    ["% como texto", { markupPct: "25", productIds: ["prod-drill"] }],
    ["motivo de más de 200 caracteres", { markupPct: 25, productIds: ["prod-drill"], reason: "x".repeat(201) }],
  ])("returns 400 for %s and changes nothing", async (_name, payload) => {
    const before = getProductById("prod-drill", DEFAULT_STORE_ID).salePriceRef;

    const response = await post(payload);

    expect(response.status).toBe(400);
    expect(getProductById("prod-drill", DEFAULT_STORE_ID).salePriceRef).toBe(before);
  });

  // FIN-03 · el reprecio masivo no tenía clave de idempotencia: 8 llamadas iguales = 8 filas de historial por producto.
  describe("idempotencia (FIN-03)", () => {
    const KEY = "7b0c7a52-7f0e-4c7e-9d50-0c1f4f1f0a01";
    const OTHER_KEY = "7b0c7a52-7f0e-4c7e-9d50-0c1f4f1f0a02";

    it("8 llamadas iguales con la misma clientRequestId dejan UN cambio de precio por producto", async () => {
      const ids = [newProduct(8, 9), newProduct(8, 9)];
      const before = historyRows(ids);
      const payload = { clientRequestId: KEY, markupPct: 25, productIds: ids };
      const bodies = [];

      for (let call = 0; call < 8; call += 1) {
        const response = await post(payload);
        expect(response.status).toBe(200);
        bodies.push((await response.json()).data);
      }

      // Las 8 responden lo mismo: el reintento recibe el resultado del primer envío.
      for (const data of bodies) {
        expect(data).toEqual({
          failed: 0,
          results: ids.map((productId) => ({ productId, salePriceRef: 10, status: "ok" })),
          updated: 2,
        });
      }
      expect(historyRows(ids)).toEqual(before.map((rows) => rows + 1));
    });

    it("la misma clave no vuelve a repreciar aunque el precio haya cambiado después", async () => {
      const id = newProduct(8, 9);
      const payload = { clientRequestId: OTHER_KEY, markupPct: 25, productIds: [id] };

      await post(payload);
      // Otro usuario fija después otro precio: el reintento tardío no lo pisa.
      await post({ markupPct: 50, productIds: [id] });
      const rows = historyRows([id]);
      const retry = await post(payload);

      expect((await retry.json()).data).toEqual({
        failed: 0,
        results: [{ productId: id, salePriceRef: 12, status: "ok" }],
        updated: 1,
      });
      expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(12);
      expect(historyRows([id])).toEqual(rows);
    });

    it("la misma clave con otro % responde un error en la fila (CONFLICT) y no cambia nada", async () => {
      const id = newProduct(8, 9);
      const key = "7b0c7a52-7f0e-4c7e-9d50-0c1f4f1f0a03";

      await post({ clientRequestId: key, markupPct: 25, productIds: [id] });
      const rows = historyRows([id]);
      const response = await post({ clientRequestId: key, markupPct: 40, productIds: [id] });

      expect((await response.json()).data).toEqual({
        failed: 1,
        results: [{ code: "CONFLICT", message: expect.any(String), productId: id, status: "error" }],
        updated: 0,
      });
      expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(10);
      expect(historyRows([id])).toEqual(rows);
    });

    it("sin clave, repetir un reprecio que no cambia el precio no inserta historial", async () => {
      const ids = [newProduct(8, 9), newProduct(8, 9)];
      const before = historyRows(ids);

      for (let call = 0; call < 8; call += 1) {
        const response = await post({ markupPct: 25, productIds: ids });
        expect((await response.json()).data.updated).toBe(2);
      }

      expect(historyRows(ids)).toEqual(before.map((rows) => rows + 1));
    });

    it("un producto en la cola sale de ella aunque el % pedido deje el mismo precio", async () => {
      // Costo 8 → 9 con precio 10: al 11,11 % el precio sigue en 10, pero la instantánea cambia.
      const id = newProduct(8, 10);
      applyMockPurchaseCost(id, 9, mockPurchases[0].id);
      const [before] = historyRows([id]);
      expect(await queuedIds()).toContain(id);

      await post({ markupPct: 11.11, productIds: [id] });

      expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(10);
      expect(historyRows([id])).toEqual([before + 1]);
      expect(await queuedIds()).not.toContain(id);
    });

    it("clientRequestId que no es un uuid → 400", async () => {
      const id = newProduct(8, 9);

      expect((await post({ clientRequestId: "no-uuid", markupPct: 25, productIds: [id] })).status).toBe(400);
      expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(9);
    });
  });

  it.each(["vendedor", "contador"])("returns 403 for %s (no products.manage) and changes nothing", async (role) => {
    const id = newProduct(9, 10);

    const response = await post({ markupPct: 25, productIds: [id] }, role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(10);
  });
});
