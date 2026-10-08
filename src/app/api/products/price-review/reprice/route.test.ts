/**
 * @jest-environment node
 */

import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import { createProduct, getProductById } from "@/modules/products/services/products.mock-server";
import { mockPurchases } from "@/shared/mocks/erp-data";
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

  it.each(["vendedor", "contador"])("returns 403 for %s (no products.manage) and changes nothing", async (role) => {
    const id = newProduct(9, 10);

    const response = await post({ markupPct: 25, productIds: [id] }, role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(getProductById(id, DEFAULT_STORE_ID).salePriceRef).toBe(10);
  });
});
