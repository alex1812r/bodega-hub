/**
 * @jest-environment node
 */
/**
 * INT-04 · espejo en el mock de `20261012b-price-review-disassemble.sql`: los
 * componentes de un empaque desarmado al recibir, si bajan de banda, entran en la
 * cola "Por revisar" atribuidos a ESA compra (la que pide el aviso de reprecio
 * del detalle de la compra con `?purchaseId=`). El mismo criterio que prueba
 * contra la base `scripts/stock-lab/regression/price-review-disassemble.test.ts`.
 */

import { convertPackToUnits, createStockAdjustment } from "@/modules/inventory/services/inventory.mock-server";
import { listPriceReview } from "@/modules/products/services/priceReview.mock-server";
import { updateSettings } from "@/modules/settings/services/settings.mock-server";
import { mockProductPackConversions, mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { createPurchase, getPurchaseById, receivePurchase } from "./purchases.mock-server";

const base = { discountRef: 0, refRateVes: 100, supplierId: "cont-supplier", taxRef: 0 };

let sequence = 0;

function addProduct(id: string, name: string, cost: number, price: number) {
  mockProducts.push({
    categoryId: "cat-tools",
    currentCostRef: cost,
    currentStock: 0,
    id,
    isActive: true,
    minStock: 0,
    name,
    salePriceRef: price,
    sku: id,
    storeId: DEFAULT_STORE_ID,
  });
}

/**
 * Caja de 6 (2 + 2 + 2) a ref 12 con sabores a ref 1,50 que se venden a ref 2,20
 * (46,7 %, verde): abrirla los deja en ref 2,00 (10 %, rojo).
 */
function seedKit() {
  sequence += 1;
  const prefix = `rvz${String(sequence).padStart(2, "0")}`;
  const packId = `${prefix}-pack`;
  const unitIds = ["a", "b", "c"].map((suffix) => `${prefix}-${suffix}`);

  addProduct(packId, `Caja ${prefix}`, 12, 30);
  unitIds.forEach((id) => addProduct(id, `Sabor ${id}`, 1.5, 2.2));
  mockProductPackConversions.push({
    components: unitIds.map((unitProductId) => ({ costWeight: 1, unitProductId, unitsPerPack: 2 })),
    id: `${prefix}-recipe`,
    isActive: true,
    packProductId: packId,
    storeId: DEFAULT_STORE_ID,
    totalUnits: 6,
    unitProductId: null,
    unitsPerPack: 6,
  });

  return { packId, unitIds };
}

function packLine(productId: string, quantity: number, marked: boolean): PurchaseItemInput {
  return {
    costCurrency: "ref",
    ...(marked ? { disassembleOnReceive: true } : {}),
    entryMode: "unit",
    productId,
    quantity,
    subtotalRef: quantity * 12,
    subtotalVes: quantity * 12 * 100,
    taxRateCode: "exento",
    taxRef: 0,
    taxVes: 0,
    unitCostRef: 12,
    unitCostVes: 1200,
  };
}

function reviewOfPurchase(purchaseId: string) {
  return listPriceReview(new URLSearchParams({ limit: "100", purchaseId }), DEFAULT_STORE_ID)
    .items.map((item) => item.productId)
    .sort();
}

function inQueue(productId: string) {
  return (
    listPriceReview(new URLSearchParams("limit=100"), DEFAULT_STORE_ID).items.find(
      (item) => item.productId === productId,
    ) ?? null
  );
}

beforeEach(() => {
  updateSettings(
    { pricing: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } },
    DEFAULT_STORE_ID,
  );
});

describe("INT-04 · cola «Por revisar» de los componentes de un empaque desarmado al recibir (mock)", () => {
  it("compra que nace recibida: los 3 sabores quedan en la cola con ESA compra", () => {
    const { packId, unitIds } = seedKit();
    const purchase = createPurchase(
      { ...base, items: [packLine(packId, 3, true)], status: "recibido" },
      DEFAULT_STORE_ID,
    );

    expect(reviewOfPurchase(purchase.id)).toEqual([...unitIds].sort());
    expect(inQueue(unitIds[0])).toMatchObject({
      currentCostRef: 2,
      previousCostRef: 1.5,
      purchase: { id: purchase.id, number: purchase.purchaseNumber },
    });
    expect(inQueue(packId)).toBeNull();
  });

  it("pedido que se recibe después: se atribuyen al recibir, no antes", () => {
    const { packId, unitIds } = seedKit();
    const ordered = createPurchase(
      { ...base, items: [packLine(packId, 3, true)], status: "pedido" },
      DEFAULT_STORE_ID,
    );
    const whileOrdered = reviewOfPurchase(ordered.id);

    receivePurchase(ordered.id, DEFAULT_STORE_ID);

    expect(whileOrdered).toEqual([]);
    expect(getPurchaseById(ordered.id, DEFAULT_STORE_ID).status).toBe("recibido");
    expect(reviewOfPurchase(ordered.id)).toEqual([...unitIds].sort());
  });

  it("apertura a mano: los sabores entran en la cola sin compra", () => {
    const { packId, unitIds } = seedKit();

    // Asegura la línea base (costo 1,50) antes de que la apertura suba el costo.
    listPriceReview(new URLSearchParams("limit=1"), DEFAULT_STORE_ID);
    createStockAdjustment({ productId: packId, quantityDelta: 3, type: "ajuste_entrada" }, DEFAULT_STORE_ID);
    convertPackToUnits({ packProductId: packId, packQuantity: 3 }, DEFAULT_STORE_ID);

    const item = inQueue(unitIds[0]);

    expect(item).toMatchObject({ currentCostRef: 2, previousCostRef: 1.5 });
    expect(item?.purchase).toBeUndefined();
  });
});
