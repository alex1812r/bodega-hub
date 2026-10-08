/**
 * @jest-environment node
 *
 * PRO-F9 · hallazgos de CAOS vistos desde las rutas (fuente de datos mock, con
 * paridad con la base):
 * - ALTA-1: `reprice` acepta `items` con el costo que el usuario vio y marca
 *   `COST_CHANGED` la fila cuyo costo ya es otro; `POST …/price` acepta
 *   `expectedCostRef` y responde 409.
 * - M1: `POST …/keep-price` acepta `expectedCostRef` y responde 409.
 * - ALTA-2: `POST /api/products` acepta `clientRequestId` y el reintento no
 *   duplica el producto ni su `inventario_inicial`.
 */

import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import {
  createProduct,
  getProductById,
  getProductPriceHistory,
  listProducts,
} from "@/modules/products/services/products.mock-server";
import { mockPurchases, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST as postKeepPrice } from "./[id]/keep-price/route";
import { POST as postPrice } from "./[id]/price/route";
import { POST as postReprice } from "./price-review/reprice/route";
import { POST as postProduct } from "./route";

const COST_CHANGED_MESSAGE = "El costo cambió de 12.00 a 20.00; revisa el precio";
const context = (id: string) => ({ params: Promise.resolve({ id }) });

function json(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-demo-role": "almacen" },
    method: "POST",
  });
}

let sequence = 0;

/** Producto en verde (costo 12, precio 16) cuyo costo sube a 20 con una compra: el usuario aún ve 12. */
function productWithMovedCost() {
  sequence += 1;
  const id = createProduct(
    { currentCostRef: 12, name: `F9 ruta ${sequence}`, salePriceRef: 16, sku: `f9-route-${sequence}` },
    DEFAULT_STORE_ID,
  ).id;
  applyMockPurchaseCost(id, 20, mockPurchases[0].id);

  return id;
}

function historyRows(id: string) {
  return getProductPriceHistory(id, new URLSearchParams("limit=100"), DEFAULT_STORE_ID).items.length;
}

describe("PRO-F9 · rutas de productos", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("POST /api/products/price-review/reprice", () => {
    it("con items: 200 con la fila COST_CHANGED del producto cuyo costo cambió, sin tocar su precio", async () => {
      const stale = productWithMovedCost();
      const fresh = productWithMovedCost();

      const response = await postReprice(
        json("/api/products/price-review/reprice", {
          items: [
            { expectedCostRef: 12, productId: stale },
            { expectedCostRef: 20, productId: fresh },
          ],
          markupPct: 30,
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({
        failed: 1,
        results: [
          { code: "COST_CHANGED", message: COST_CHANGED_MESSAGE, productId: stale, status: "error" },
          { productId: fresh, salePriceRef: 26, status: "ok" },
        ],
        updated: 1,
      });
      expect(getProductById(stale, DEFAULT_STORE_ID).salePriceRef).toBe(16);
    });

    it("sigue aceptando solo productIds (sin comprobación de costo) y rechaza un cuerpo sin productos o con más de 100", async () => {
      const id = productWithMovedCost();

      const legacy = await postReprice(json("/api/products/price-review/reprice", { markupPct: 30, productIds: [id] }));
      const empty = await postReprice(json("/api/products/price-review/reprice", { markupPct: 30 }));
      const emptyLists = await postReprice(
        json("/api/products/price-review/reprice", { items: [], markupPct: 30, productIds: [] }),
      );
      const tooMany = await postReprice(
        json("/api/products/price-review/reprice", {
          items: Array.from({ length: 60 }, (_, index) => ({ expectedCostRef: 1, productId: `a-${index}` })),
          markupPct: 30,
          productIds: Array.from({ length: 60 }, (_, index) => `b-${index}`),
        }),
      );
      const negative = await postReprice(
        json("/api/products/price-review/reprice", { items: [{ expectedCostRef: -1, productId: id }], markupPct: 30 }),
      );

      expect((await legacy.json()).data.results).toEqual([{ productId: id, salePriceRef: 26, status: "ok" }]);
      expect([empty.status, emptyLists.status, tooMany.status, negative.status]).toEqual([400, 400, 400, 400]);
    });
  });

  describe("POST /api/products/[id]/price", () => {
    it("con el costo viejo responde 409 con el mensaje y no cambia el precio ni el historial", async () => {
      const id = productWithMovedCost();
      const rowsBefore = historyRows(id);

      const response = await postPrice(
        json(`/api/products/${id}/price`, { expectedCostRef: 12, reason: "Reprecio al 30 %", salePriceRef: 15.6 }),
        context(id),
      );

      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual({ code: "CONFLICT", message: COST_CHANGED_MESSAGE });
      expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(16);
      expect(historyRows(id)).toBe(rowsBefore);
    });

    it("con el costo vigente, o sin costo esperado, cambia el precio como siempre", async () => {
      const checked = productWithMovedCost();
      const legacy = productWithMovedCost();

      const withCost = await postPrice(
        json(`/api/products/${checked}/price`, { expectedCostRef: 20, salePriceRef: 26 }),
        context(checked),
      );
      const without = await postPrice(json(`/api/products/${legacy}/price`, { salePriceRef: 15.6 }), context(legacy));

      expect([withCost.status, without.status]).toEqual([200, 200]);
      expect(getProductById(checked, DEFAULT_STORE_ID).salePriceRef).toBe(26);
      expect(getProductById(legacy, DEFAULT_STORE_ID).salePriceRef).toBe(15.6);
    });
  });

  describe("POST /api/products/[id]/keep-price", () => {
    it("con el costo viejo responde 409 y el producto sigue en Por revisar; con el vigente sale", async () => {
      const id = productWithMovedCost();
      const rowsBefore = historyRows(id);

      const stale = await postKeepPrice(json(`/api/products/${id}/keep-price`, { expectedCostRef: 12 }), context(id));

      expect(stale.status).toBe(409);
      expect((await stale.json()).error.message).toBe(COST_CHANGED_MESSAGE);
      expect(historyRows(id)).toBe(rowsBefore);
      expect(getProductById(id, DEFAULT_STORE_ID)).toHaveProperty("priceReview");

      const current = await postKeepPrice(json(`/api/products/${id}/keep-price`, { expectedCostRef: 20 }), context(id));

      expect(current.status).toBe(200);
      expect(getProductById(id, DEFAULT_STORE_ID)).not.toHaveProperty("priceReview");
    });
  });

  describe("POST /api/products", () => {
    const body = {
      categoryId: "cat-tools",
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      currentCostRef: 3,
      currentStock: 9,
      name: "F9 ruta alta reintentada",
      salePriceRef: 5,
    };

    it("el reintento con la misma clave responde 201 con el mismo producto: 1 producto y 1 inventario_inicial de 9", async () => {
      const first = await postProduct(json("/api/products", body));
      const retry = await postProduct(json("/api/products", body));
      const created = (await first.json()).data;
      const replayed = (await retry.json()).data;

      const sameName = listProducts(
        new URLSearchParams(`limit=100&search=${encodeURIComponent(body.name)}`),
        DEFAULT_STORE_ID,
      ).items.filter((product) => product.name === body.name);
      const initial = mockStockMovements.filter(
        (movement) => movement.productId === created.id && movement.type === "inventario_inicial",
      );

      expect([first.status, retry.status]).toEqual([201, 201]);
      expect(replayed).toEqual(created);
      expect(created).not.toHaveProperty("clientRequestId");
      expect(sameName).toHaveLength(1);
      expect(initial.map((movement) => movement.quantityDelta)).toEqual([9]);
    });

    it("la misma clave con otro contenido responde 409 y una clave que no es uuid, 400", async () => {
      const reused = await postProduct(json("/api/products", { ...body, currentStock: 20 }));
      const invalid = await postProduct(json("/api/products", { ...body, clientRequestId: "no-es-uuid" }));

      expect(reused.status).toBe(409);
      expect((await reused.json()).error.code).toBe("CONFLICT");
      expect(invalid.status).toBe(400);
    });
  });
});
