/**
 * @jest-environment node
 */
/**
 * SHR-10 · `next dev` vuelve a evaluar el modulo al compilar otra ruta: las
 * compras creadas en mock (y su clave de idempotencia) deben sobrevivir.
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";

type PurchasesMockServer = typeof import("./purchases.mock-server");

const KEY = "3c2b1a09-8f7e-4d6c-9b5a-413f2e1d0c9b";

const item: PurchaseItemInput = {
  costCurrency: "ref",
  entryMode: "unit",
  productId: "prod-cable",
  quantity: 2,
  subtotalRef: 4,
  subtotalVes: 2040,
  taxRateCode: "general",
  taxRef: 0.64,
  taxVes: 326.4,
  unitCostRef: 2,
  unitCostVes: 1020,
};

const input = {
  discountRef: 0,
  items: [item],
  refRateVes: 510,
  subtotalRef: 4,
  supplierId: "cont-supplier",
  taxRef: 0.64,
};

/** Una evaluacion nueva del modulo, como la que hace `next dev` al recompilar. */
async function reloadModule() {
  let instance: PurchasesMockServer | undefined;

  await jest.isolateModulesAsync(async () => {
    instance = await import("./purchases.mock-server");
  });

  if (!instance) {
    throw new Error("No se pudo cargar purchases.mock-server");
  }

  return instance;
}

describe("purchases.mock-server · re-evaluacion del modulo (SHR-10)", () => {
  it("el detalle de una compra creada antes de la recompilacion sigue respondiendo", async () => {
    const beforeReload = await reloadModule();
    const afterReload = await reloadModule();

    expect(afterReload.createPurchase).not.toBe(beforeReload.createPurchase);

    const purchase = beforeReload.createPurchase(input, DEFAULT_STORE_ID);
    const detail = afterReload.getPurchaseById(purchase.id, DEFAULT_STORE_ID);

    expect(detail.id).toBe(purchase.id);
    expect(detail.items).toEqual([
      expect.objectContaining({ productId: "prod-cable", taxRate: 16, taxRateCode: "general" }),
    ]);
  });

  it("dos compras separadas por una recompilacion reciben ids distintos", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    try {
      const first = (await reloadModule()).createPurchase(input, DEFAULT_STORE_ID);
      const afterReload = await reloadModule();
      const second = afterReload.createPurchase(input, DEFAULT_STORE_ID);

      expect(second.id).not.toBe(first.id);
      expect(afterReload.getPurchaseById(first.id, DEFAULT_STORE_ID).id).toBe(first.id);
      expect(afterReload.getPurchaseById(second.id, DEFAULT_STORE_ID).id).toBe(second.id);
    } finally {
      now.mockRestore();
    }
  });

  it("la clave de idempotencia devuelve la compra original tras la recompilacion", async () => {
    const first = (await reloadModule()).createPurchase(
      { ...input, clientRequestId: KEY },
      DEFAULT_STORE_ID,
    );
    const second = (await reloadModule()).createPurchase(
      { ...input, clientRequestId: KEY },
      DEFAULT_STORE_ID,
    );

    expect(second.id).toBe(first.id);
    expect(second).toBe(first);
  });
});
