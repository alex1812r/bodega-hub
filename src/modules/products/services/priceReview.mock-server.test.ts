/**
 * @jest-environment node
 *
 * PRO-11 · espejo en el mock del criterio de aceptación de la cola "Por revisar"
 * (el mismo que `scripts/stock-lab/regression/price-review.test.ts` prueba
 * contra la base). El mock de compras no actualiza el costo al recibir: el costo
 * sube con el fixture `applyMockPurchaseCost`.
 */

import { ApiError } from "@/lib/api/apiError";
import { updateSettings } from "@/modules/settings/services/settings.mock-server";
import {
  mockContacts,
  mockProductPriceHistory,
  mockProducts,
  mockPurchases,
  mockStockMovements,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PRICE_BASELINE_REASON } from "./priceReview";
import {
  applyMockPurchaseCost,
  getPriceReviewSummary,
  keepProductPrice,
  listPriceReview,
  repriceProducts,
} from "./priceReview.mock-server";
import {
  createProduct,
  createProductPriceHistoryEntry,
  getProductById,
  getProductPriceHistory,
  listProducts,
  updateProduct,
  updateProductPrice,
} from "./products.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULT_PRICING = { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 };
const [firstPurchase, secondPurchase] = mockPurchases;

let seq = 0;

function newProduct(costRef: number, priceRef: number, storeId = DEFAULT_STORE_ID) {
  seq += 1;

  return createProduct(
    { currentCostRef: costRef, name: `Producto en revisión ${seq}`, salePriceRef: priceRef, sku: `rev-${seq}` },
    storeId,
  ).id;
}

function queue(query = "limit=100", storeId = DEFAULT_STORE_ID) {
  return listPriceReview(new URLSearchParams(query), storeId);
}

function inQueue(productId: string, storeId = DEFAULT_STORE_ID) {
  return queue("limit=100", storeId).items.find((item) => item.productId === productId) ?? null;
}

function history(productId: string, storeId = DEFAULT_STORE_ID) {
  return getProductPriceHistory(productId, new URLSearchParams("limit=50"), storeId).items;
}

function changePrice(productId: string, salePriceRef: number, reason?: string) {
  // El mismo orden que la ruta POST /api/products/[id]/price.
  createProductPriceHistoryEntry(productId, { reason, salePriceRef }, DEFAULT_STORE_ID);
  updateProductPrice(productId, { reason, salePriceRef }, DEFAULT_STORE_ID);
}

beforeEach(() => {
  updateSettings({ pricing: DEFAULT_PRICING }, DEFAULT_STORE_ID);
});

describe("price review queue (mock) · acceptance", () => {
  it("cost 8 / price 10 (25 %, green) → purchase received at 9 (11.1 %, red): enters with 25 → 11.1, cost 8 → 9 and that purchase", () => {
    const id = newProduct(8, 10);

    expect(inQueue(id)).toBeNull();

    applyMockPurchaseCost(id, 9, firstPurchase.id);

    expect(inQueue(id)).toEqual({
      currentBand: "low",
      currentCostRef: 9,
      currentMarginPct: 11.111111,
      name: expect.any(String),
      previousBand: "high",
      previousCostRef: 8,
      previousMarginPct: 25,
      productId: id,
      purchase: {
        id: firstPurchase.id,
        number: firstPurchase.purchaseNumber,
        receivedAt: expect.any(String),
        supplierName: mockContacts.find((contact) => contact.id === firstPurchase.supplierId)?.name,
      },
      salePriceRef: 10,
      sku: expect.any(String),
      snapshotAt: expect.any(String),
    });
  });

  it("keeping the price takes it out with a history row without price change; a new purchase at 9.5 does not bring it back", () => {
    const id = newProduct(8, 10);
    applyMockPurchaseCost(id, 9, firstPurchase.id);
    const stockBefore = getProductById(id, DEFAULT_STORE_ID).currentStock;
    const movementsBefore = mockStockMovements.length;

    const entry = keepProductPrice(id, { reason: null }, DEFAULT_STORE_ID);

    expect(entry).toMatchObject({
      kind: "keep",
      previousSalePriceRef: 10,
      productId: id,
      reason: "Precio mantenido",
      salePriceRef: 10,
    });
    expect(inQueue(id)).toBeNull();
    expect(getProductById(id, DEFAULT_STORE_ID)).toMatchObject({
      currentCostRef: 9,
      currentStock: stockBefore,
      salePriceRef: 10,
    });
    expect(mockStockMovements).toHaveLength(movementsBefore);

    applyMockPurchaseCost(id, 9.5, secondPurchase.id);

    // Sigue rojo: no es peor que el rojo que se guardó al mantener.
    expect(inQueue(id)).toBeNull();
    expect(history(id).map((item) => item.kind)).toEqual(["keep", "baseline"]);
  });

  it("green → yellow → keep → red: comes back against the yellow snapshot and with the new purchase", () => {
    const id = newProduct(8, 10);

    applyMockPurchaseCost(id, 8.5, firstPurchase.id);
    expect(inQueue(id)).toMatchObject({ currentBand: "mid", previousBand: "high" });

    keepProductPrice(id, { reason: "Lo reviso el lunes" }, DEFAULT_STORE_ID);
    expect(inQueue(id)).toBeNull();

    applyMockPurchaseCost(id, 9, secondPurchase.id);
    expect(inQueue(id)).toMatchObject({
      currentBand: "low",
      currentCostRef: 9,
      previousBand: "mid",
      previousCostRef: 8.5,
      purchase: { id: secondPurchase.id },
    });
    expect(history(id)[0]).toMatchObject({ kind: "keep", reason: "Lo reviso el lunes" });
  });

  it("leaves the queue on its own when the cost drops and the band improves", () => {
    const id = newProduct(8, 10);
    applyMockPurchaseCost(id, 9, firstPurchase.id);
    expect(inQueue(id)).not.toBeNull();

    applyMockPurchaseCost(id, 7.9, secondPurchase.id);

    expect(inQueue(id)).toBeNull();
    expect(history(id).map((item) => item.kind)).toEqual(["baseline"]);
  });

  it("leaves the queue when a price change restores the band, and the change stores the new snapshot", () => {
    const id = newProduct(8, 10);
    applyMockPurchaseCost(id, 9, firstPurchase.id);

    changePrice(id, 11.25, "Sube el proveedor");

    expect(inQueue(id)).toBeNull();
    expect(history(id)[0]).toMatchObject({
      kind: "change",
      previousSalePriceRef: 10,
      reason: "Sube el proveedor",
      salePriceRef: 11.25,
    });
    expect(mockProductPriceHistory.at(-1)).toMatchObject({ costRefSnapshot: 9, marginBandSnapshot: "high" });

    // La instantánea nueva es la referencia: otra subida que baja la banda lo devuelve.
    applyMockPurchaseCost(id, 10, secondPurchase.id);
    expect(inQueue(id)).toMatchObject({ currentBand: "low", previousBand: "high", previousCostRef: 9 });
  });

  it("recomputes the current band with the store thresholds when they change", () => {
    const id = newProduct(8, 10);
    applyMockPurchaseCost(id, 9, firstPurchase.id);
    expect(inQueue(id)).toMatchObject({ currentBand: "low" });

    updateSettings({ pricing: { ...DEFAULT_PRICING, greenFromPct: 10, yellowFromPct: 5 } }, DEFAULT_STORE_ID);
    expect(inQueue(id)).toBeNull();

    updateSettings({ pricing: { ...DEFAULT_PRICING, greenFromPct: 12, yellowFromPct: 5 } }, DEFAULT_STORE_ID);
    expect(inQueue(id)).toMatchObject({ currentBand: "mid", previousBand: "high" });
  });

  it("another store sees nothing, and cannot keep the price of a product that is not its own", () => {
    const id = newProduct(8, 10);
    applyMockPurchaseCost(id, 9, firstPurchase.id);

    expect(inQueue(id, OTHER_STORE_ID)).toBeNull();
    expect(getPriceReviewSummary(OTHER_STORE_ID)).toEqual({ total: 0 });
    expect(() => keepProductPrice(id, { reason: null }, OTHER_STORE_ID)).toThrow(ApiError);
    expect(inQueue(id)).not.toBeNull();
  });

  it("a product just created gets its baseline and enters on the first cost rise that lowers its band", () => {
    const id = newProduct(8, 10);

    expect(history(id)).toEqual([
      expect.objectContaining({
        kind: "baseline",
        previousSalePriceRef: 10,
        reason: PRICE_BASELINE_REASON,
        salePriceRef: 10,
      }),
    ]);

    applyMockPurchaseCost(id, 9, firstPurchase.id);

    expect(inQueue(id)).toMatchObject({ currentBand: "low", previousBand: "high" });
  });

  it("40 products drop a band in one reception: the 40 are in the queue with that purchase and the batch reprice takes them out", () => {
    const ids = Array.from({ length: 40 }, () => newProduct(8, 10));
    for (const id of ids) applyMockPurchaseCost(id, 9, secondPurchase.id);

    const queued = queue(`limit=100&purchaseId=${secondPurchase.id}`).items.map((item) => item.productId);
    expect(queued).toEqual(expect.arrayContaining(ids));
    expect(new Set(ids).size).toBe(40);

    const result = repriceProducts({ markupPct: 25, productIds: ids, reason: null }, DEFAULT_STORE_ID);

    expect(result).toMatchObject({ failed: 0, updated: 40 });
    expect(result.results[0]).toEqual({ productId: ids[0], salePriceRef: 11.25, status: "ok" });
    expect(queue("limit=100").items.filter((item) => ids.includes(item.productId))).toEqual([]);
    expect(history(ids[0])[0]).toMatchObject({
      kind: "change",
      previousSalePriceRef: 10,
      reason: "Reprecio al 25 %",
      salePriceRef: 11.25,
    });
  });
});

describe("price review queue (mock) · rules that keep a product out", () => {
  it("does not enter when the cost rises inside the same band, when the price is lowered by hand, without cost or when inactive", () => {
    const sameBand = newProduct(5, 10);
    const lowered = newProduct(8, 10);
    const noCost = newProduct(0, 10);
    const inactive = newProduct(8, 10);

    applyMockPurchaseCost(sameBand, 6, firstPurchase.id);
    updateProduct(lowered, { salePriceRef: 8.5 }, DEFAULT_STORE_ID);
    applyMockPurchaseCost(noCost, 9, firstPurchase.id);
    applyMockPurchaseCost(inactive, 9, firstPurchase.id);
    updateProduct(inactive, { isActive: false }, DEFAULT_STORE_ID);

    expect([sameBand, lowered, noCost, inactive].map((id) => inQueue(id))).toEqual([null, null, null, null]);
  });

  it("enters without purchase when the cost rises through an edit", () => {
    const id = newProduct(8, 10);

    updateProduct(id, { currentCostRef: 9 }, DEFAULT_STORE_ID);

    const review = inQueue(id);
    expect(review).toMatchObject({ currentCostRef: 9, previousCostRef: 8 });
    expect(review).not.toHaveProperty("purchase");
  });

  it("a seed product that never changed price gets its baseline before the cost moves", () => {
    const drill = mockProducts.find((product) => product.id === "prod-drill");
    if (!drill) throw new Error("falta prod-drill en los mocks");
    const original = { cost: drill.currentCostRef, price: drill.salePriceRef };

    try {
      drill.salePriceRef = 10;
      drill.currentCostRef = 8;
      // Sin instantánea previa: la primera lectura toma la línea base con el costo de ese momento.
      const withoutSnapshots = mockProductPriceHistory.filter(
        (entry) => entry.productId !== "prod-drill" || entry.snapshotSeq === undefined,
      );
      mockProductPriceHistory.splice(0, mockProductPriceHistory.length, ...withoutSnapshots);

      applyMockPurchaseCost("prod-drill", 9, firstPurchase.id);

      expect(inQueue("prod-drill")).toMatchObject({ currentBand: "low", previousBand: "high", previousCostRef: 8 });
    } finally {
      drill.salePriceRef = original.price;
      drill.currentCostRef = original.cost;
      keepProductPrice("prod-drill", { reason: null }, DEFAULT_STORE_ID);
    }
  });
});

describe("price review queue (mock) · list, summary and product endpoints", () => {
  it("orders the worst band first and the biggest drop inside it, paginates and counts", () => {
    const yellow = newProduct(8, 10);
    const red = newProduct(8, 10);
    const redder = newProduct(4, 10);
    applyMockPurchaseCost(yellow, 8.5, firstPurchase.id);
    applyMockPurchaseCost(red, 9, firstPurchase.id);
    applyMockPurchaseCost(redder, 9.5, firstPurchase.id);

    const order = queue("limit=100")
      .items.map((item) => item.productId)
      .filter((id) => [yellow, red, redder].includes(id));
    const total = queue("limit=100").total;

    expect(order).toEqual([redder, red, yellow]);
    expect(getPriceReviewSummary(DEFAULT_STORE_ID)).toEqual({ total });
    expect(queue("limit=10&skip=0").items.length).toBeLessThanOrEqual(10);
    expect(queue("limit=10&skip=0").total).toBe(total);
  });

  it("filters by the purchase that raised the cost", () => {
    const first = newProduct(8, 10);
    const second = newProduct(8, 10);
    const edited = newProduct(8, 10);
    applyMockPurchaseCost(first, 9, firstPurchase.id);
    applyMockPurchaseCost(second, 9, secondPurchase.id);
    updateProduct(edited, { currentCostRef: 9 }, DEFAULT_STORE_ID);

    const ofFirst = queue(`limit=100&purchaseId=${firstPurchase.id}`).items.map((item) => item.productId);

    expect(ofFirst).toContain(first);
    expect(ofFirst).not.toContain(second);
    expect(ofFirst).not.toContain(edited);
    expect(queue("limit=100&purchaseId=no-existe").items).toEqual([]);
  });

  it("GET /api/products exposes priceReview only on queued products and review=1 keeps only those", () => {
    const queued = newProduct(8, 10);
    const calm = newProduct(8, 10);
    applyMockPurchaseCost(queued, 9, firstPurchase.id);

    const all = listProducts(new URLSearchParams("limit=100&search=Producto en revisión"), DEFAULT_STORE_ID);
    const onlyReview = listProducts(new URLSearchParams("limit=100&review=1"), DEFAULT_STORE_ID);
    const combined = listProducts(new URLSearchParams("limit=100&review=1&margin=high"), DEFAULT_STORE_ID);

    expect(all.items.find((product) => product.id === queued)?.priceReview).toMatchObject({
      currentBand: "low",
      previousBand: "high",
      purchase: { id: firstPurchase.id },
    });
    expect(all.items.find((product) => product.id === calm)).not.toHaveProperty("priceReview");
    expect(onlyReview.items.map((product) => product.id)).toContain(queued);
    expect(onlyReview.items.map((product) => product.id)).not.toContain(calm);
    expect(onlyReview.items.every((product) => product.priceReview !== undefined)).toBe(true);
    expect(onlyReview.total).toBe(getPriceReviewSummary(DEFAULT_STORE_ID).total);
    // Se combina con los demás filtros: nada en la cola está en verde.
    expect(combined.items).toEqual([]);
  });

  it("GET /api/products/[id] exposes priceReview while the product is in the queue", () => {
    const id = newProduct(8, 10);

    expect(getProductById(id, DEFAULT_STORE_ID)).not.toHaveProperty("priceReview");

    applyMockPurchaseCost(id, 9, firstPurchase.id);
    expect(getProductById(id, DEFAULT_STORE_ID).priceReview).toMatchObject({ currentBand: "low" });

    keepProductPrice(id, { reason: null }, DEFAULT_STORE_ID);
    expect(getProductById(id, DEFAULT_STORE_ID)).not.toHaveProperty("priceReview");
  });
});

describe("repriceProducts (mock)", () => {
  it("answers per product without aborting the batch: no cost and unknown ids are row errors, never price 0", () => {
    const ok = newProduct(9, 10);
    const noCost = newProduct(0, 4);
    const foreign = newProduct(9, 10, OTHER_STORE_ID);

    const result = repriceProducts(
      { markupPct: 30, productIds: [noCost, ok, "prod-inexistente", foreign, ok], reason: "Ajuste de octubre" },
      DEFAULT_STORE_ID,
    );

    expect(result).toEqual({
      failed: 3,
      results: [
        { code: "NO_COST", message: expect.stringContaining("no tiene costo"), productId: noCost, status: "error" },
        { productId: ok, salePriceRef: 11.7, status: "ok" },
        { code: "NOT_FOUND", message: "Producto no encontrado.", productId: "prod-inexistente", status: "error" },
        { code: "NOT_FOUND", message: "Producto no encontrado.", productId: foreign, status: "error" },
      ],
      updated: 1,
    });
    expect(getProductById(noCost, DEFAULT_STORE_ID).salePriceRef).toBe(4);
    expect(getProductById(foreign, OTHER_STORE_ID).salePriceRef).toBe(10);
    expect(history(ok)[0]).toMatchObject({ kind: "change", reason: "Ajuste de octubre", salePriceRef: 11.7 });
  });
});

describe("applyMockPurchaseCost (fixture)", () => {
  it("sets the cost like a received purchase would and never writes the stock", () => {
    const id = newProduct(8, 10);
    const before = getProductById(id, DEFAULT_STORE_ID).currentStock;

    const product = applyMockPurchaseCost(id, 9.25, firstPurchase.id);

    expect(product).toMatchObject({ currentCostRef: 9.25, currentStock: before });
    expect(() => applyMockPurchaseCost("prod-inexistente", 1)).toThrow("Producto mock no encontrado");
  });
});
