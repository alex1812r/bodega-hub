/**
 * @jest-environment node
 */
/**
 * SHR-10 · IVA por linea en modo mock: las mismas reglas (y textos) que
 * `create_purchase` tras el parche 20261007a.
 */

import {
  createTaxRate,
  updateTaxRate,
} from "@/modules/settings/services/taxRates.mock-server";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";
import { mockProducts, mockPurchases, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { createPurchase, getPurchaseById, listPurchases } from "./purchases.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function line(tax: Pick<PurchaseItemInput, "taxRate" | "taxRateCode">): PurchaseItemInput {
  return {
    costCurrency: "ref",
    entryMode: "unit",
    productId: "prod-cable",
    quantity: 2,
    subtotalRef: 4,
    subtotalVes: 2040,
    taxRef: 0.64,
    taxVes: 326.4,
    unitCostRef: 2,
    unitCostVes: 1020,
    ...tax,
  };
}

function create(items: PurchaseItemInput[], storeId = DEFAULT_STORE_ID) {
  return createPurchase(
    {
      discountRef: 0,
      items,
      refRateVes: 510,
      subtotalRef: 4,
      supplierId: "cont-supplier",
      taxRef: 0.64,
    },
    storeId,
  );
}

function savedLines(purchaseId: string, storeId = DEFAULT_STORE_ID) {
  return getPurchaseById(purchaseId, storeId).items.map((item) => ({
    taxRate: item.taxRate,
    taxRateCode: item.taxRateCode,
  }));
}

describe("purchases.mock-server · IVA por linea (SHR-10)", () => {
  beforeEach(() => {
    resetMockTaxRates();
  });

  it("rechaza con 400 un porcentaje que no es de ninguna alicuota activa (13)", () => {
    expect(() => create([line({ taxRate: 13 })])).toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
        message: "El porcentaje de IVA 13.00 % no corresponde a ninguna alicuota activa",
        status: 400,
      }),
    );
  });

  it("rechaza con 400 un codigo que no existe", () => {
    expect(() => create([line({ taxRateCode: "lujo" })])).toThrow(
      expect.objectContaining({
        message: 'La alicuota de IVA "lujo" no existe o no esta activa en tu tienda',
        status: 400,
      }),
    );
  });

  it("rechaza con 400 un codigo inactivo, y tambien su porcentaje suelto", () => {
    updateTaxRate("tax-reducida", { isActive: false }, DEFAULT_STORE_ID);

    expect(() => create([line({ taxRateCode: "reducida" })])).toThrow(
      expect.objectContaining({
        message: 'La alicuota de IVA "reducida" no existe o no esta activa en tu tienda',
        status: 400,
      }),
    );
    expect(() => create([line({ taxRate: 8 })])).toThrow(
      expect.objectContaining({
        message: "El porcentaje de IVA 8.00 % no corresponde a ninguna alicuota activa",
        status: 400,
      }),
    );
    // Otra tienda sigue viendo la global activa.
    expect(savedLines(create([line({ taxRate: 8 })], OTHER_STORE_ID).id, OTHER_STORE_ID)).toEqual([
      { taxRate: 8, taxRateCode: "reducida" },
    ]);
  });

  it("rechaza con 400 un codigo de otra tienda", () => {
    createTaxRate({ label: "Lujo", pct: 31 }, OTHER_STORE_ID);

    expect(() => create([line({ taxRateCode: "lujo" })])).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => create([line({ taxRate: 31 })])).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("rechaza con 400 un codigo y un porcentaje que no coinciden", () => {
    expect(() => create([line({ taxRate: 8, taxRateCode: "general" })])).toThrow(
      expect.objectContaining({
        message:
          'El porcentaje de IVA enviado (8.00 %) no coincide con la alicuota "general" (16.00 %)',
        status: 400,
      }),
    );
  });

  it("con solo el codigo deriva el porcentaje de la alicuota", () => {
    const purchase = create([line({ taxRateCode: "general" }), line({ taxRateCode: " exento " })]);

    expect(savedLines(purchase.id)).toEqual([
      { taxRate: 16, taxRateCode: "general" },
      { taxRate: 0, taxRateCode: "exento" },
    ]);
  });

  it("con solo un porcentaje valido guarda el codigo de su alicuota", () => {
    const purchase = create([line({ taxRate: 16 }), line({ taxRate: 0 }), line({ taxRate: 8 })]);

    expect(savedLines(purchase.id)).toEqual([
      { taxRate: 16, taxRateCode: "general" },
      { taxRate: 0, taxRateCode: "exento" },
      { taxRate: 8, taxRateCode: "reducida" },
    ]);
  });

  it("acepta codigo y porcentaje cuando coinciden, y una alicuota propia de la tienda", () => {
    createTaxRate({ label: "Lujo", pct: 31 }, DEFAULT_STORE_ID);

    const purchase = create([
      line({ taxRate: 16, taxRateCode: "general" }),
      line({ taxRateCode: "lujo" }),
      line({ taxRate: 31 }),
    ]);

    expect(savedLines(purchase.id)).toEqual([
      { taxRate: 16, taxRateCode: "general" },
      { taxRate: 31, taxRateCode: "lujo" },
      { taxRate: 31, taxRateCode: "lujo" },
    ]);
  });

  it("una linea invalida rechaza la compra entera", () => {
    const before = listPurchases(new URLSearchParams("limit=100"), DEFAULT_STORE_ID).total;

    expect(() => create([line({ taxRateCode: "general" }), line({ taxRate: 13 })])).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(listPurchases(new URLSearchParams("limit=100"), DEFAULT_STORE_ID).total).toBe(before);
  });

  it("la linea congela el porcentaje: cambiar la alicuota despues no la altera", () => {
    const purchase = create([line({ taxRateCode: "general" })]);

    updateTaxRate("tax-general", { pct: 12 }, DEFAULT_STORE_ID);

    expect(savedLines(purchase.id)).toEqual([{ taxRate: 16, taxRateCode: "general" }]);
    expect(savedLines(create([line({ taxRateCode: "general" })]).id)).toEqual([
      { taxRate: 12, taxRateCode: "general" },
    ]);
  });

  // El costo SI cambia al recibir (PRO-10, `purchases.mock-server.test.ts`).
  it("no toca stock, movimientos ni los agregados de la semilla", () => {
    const stock = mockProducts.map((product) => [product.id, product.currentStock]);
    const movements = mockStockMovements.length;
    const purchases = mockPurchases.length;

    const purchase = create([line({ taxRateCode: "general" })]);

    expect(mockProducts.map((product) => [product.id, product.currentStock])).toEqual(stock);
    expect(mockStockMovements).toHaveLength(movements);
    expect(mockPurchases).toHaveLength(purchases);
    expect(purchase.totalRef).toBe(4.64);
    expect(() => getPurchaseById(purchase.id, OTHER_STORE_ID)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});
