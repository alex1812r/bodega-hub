/**
 * @jest-environment node
 */
/**
 * COM-F11 · último costo de compra en el mock: lee las compras de la semilla y las
 * creadas en la sesión, solo recibidas, primero del proveedor y luego de cualquiera.
 */

import {
  mockPurchaseItems,
  mockPurchases,
  type PurchaseItemMock,
  type PurchaseMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { listPurchaseLastCosts } from "./purchaseLastCosts.mock-server";
import { createdMockPurchases } from "./purchaseMockStore";
import { createPurchase, receivePurchase } from "./purchases.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-0000000000ff";

function seedPurchase(
  purchase: Partial<PurchaseMock> & Pick<PurchaseMock, "createdAt" | "id" | "status" | "supplierId">,
  items: Array<Pick<PurchaseItemMock, "productId" | "unitCostRef"> & Partial<PurchaseItemMock>>,
) {
  mockPurchases.push({
    discountRef: 0,
    paidVes: 0,
    purchaseNumber: purchase.id,
    refRateVes: 510,
    subtotalRef: 0,
    taxRef: 0,
    totalRef: 0,
    totalVes: 0,
    userId: "user-warehouse",
    ...purchase,
  });
  mockPurchaseItems.push(
    ...items.map((item) => ({
      purchaseId: purchase.id,
      quantity: 1,
      subtotalRef: item.unitCostRef,
      subtotalVes: 0,
      unitCostVes: 0,
      ...item,
    })),
  );
}

/** Una unidad de Taladro a `unitCostRef` sin IVA, con la alícuota `taxRateCode`. */
function line({
  taxRateCode = "general",
  unitCostRef,
}: {
  taxRateCode?: string;
  unitCostRef: number;
}): PurchaseItemInput {
  return {
    costCurrency: "ref",
    entryMode: "unit",
    productId: "prod-drill",
    quantity: 1,
    subtotalRef: unitCostRef,
    subtotalVes: unitCostRef * 510,
    taxRateCode,
    taxRef: 0,
    taxVes: 0,
    unitCostRef,
    unitCostVes: unitCostRef * 510,
  };
}

function lastCost(productId: string, supplierId = "cont-supplier", storeId = DEFAULT_STORE_ID) {
  return listPurchaseLastCosts({ productIds: [productId], supplierId }, storeId)[0];
}

describe("purchaseLastCosts.mock-server", () => {
  const seededPurchases = mockPurchases.length;
  const seededItems = mockPurchaseItems.length;

  afterEach(() => {
    mockPurchases.splice(seededPurchases);
    mockPurchaseItems.splice(seededItems);
    createdMockPurchases().clear();
  });

  it("devuelve el unitario sin IVA y la alícuota de la línea recibida de la semilla", () => {
    expect(lastCost("prod-cable")).toEqual({
      productId: "prod-cable",
      source: "supplier",
      taxRate: 0,
      unitCostRef: 2,
    });
  });

  it("si ese proveedor nunca lo vendió, da la última de cualquier proveedor (source any)", () => {
    expect(lastCost("prod-cable", "cont-both")).toMatchObject({ source: "any", unitCostRef: 2 });
  });

  it("no cuentan pedidos sin recibir, compras anuladas ni devueltas: el producto no aparece", () => {
    // Semilla: Taladro solo en una compra anulada; Tubo en un pedido y en una devuelta.
    expect(
      listPurchaseLastCosts(
        { productIds: ["prod-drill", "prod-pipe", "prod-hammer", "no-existe"], supplierId: "cont-supplier" },
        DEFAULT_STORE_ID,
      ),
    ).toEqual([]);
  });

  it("entre varias compras recibidas gana la más reciente, y la del proveedor a una más nueva de otro", () => {
    seedPurchase(
      { createdAt: "2026-06-01T10:00:00.000Z", id: "f11-vieja", status: "recibido", supplierId: "cont-supplier" },
      [{ productId: "prod-drill", taxRate: 16, unitCostRef: 2000 }],
    );
    seedPurchase(
      { createdAt: "2026-06-03T10:00:00.000Z", id: "f11-nueva", status: "recibido", supplierId: "cont-supplier" },
      [{ productId: "prod-drill", taxRate: 0, unitCostRef: 2494.41 }],
    );
    seedPurchase(
      { createdAt: "2026-06-09T10:00:00.000Z", id: "f11-otro", status: "recibido", supplierId: "cont-both" },
      [{ productId: "prod-drill", taxRate: 16, unitCostRef: 3000 }],
    );
    seedPurchase(
      { createdAt: "2026-06-10T10:00:00.000Z", id: "f11-anulada", status: "cancelado", supplierId: "cont-supplier" },
      [{ productId: "prod-drill", taxRate: 16, unitCostRef: 1 }],
    );

    expect(lastCost("prod-drill")).toEqual({
      productId: "prod-drill",
      source: "supplier",
      taxRate: 0,
      unitCostRef: 2494.41,
    });
    expect(lastCost("prod-drill", "cont-supplier-tools")).toMatchObject({
      source: "any",
      unitCostRef: 3000,
    });
  });

  it("no lee compras de otra tienda", () => {
    seedPurchase(
      {
        createdAt: "2026-06-03T10:00:00.000Z",
        id: "f11-ajena",
        status: "recibido",
        storeId: OTHER_STORE_ID,
        supplierId: "cont-supplier",
      },
      [{ productId: "prod-drill", unitCostRef: 77 }],
    );

    expect(lastCost("prod-drill")).toBeUndefined();
    expect(lastCost("prod-drill", "cont-supplier", OTHER_STORE_ID)).toMatchObject({ unitCostRef: 77 });
  });

  it("ve la compra creada en la sesión: tras una compra exenta, el último costo es su neto", () => {
    createPurchase(
      { items: [line({ taxRateCode: "general", unitCostRef: 2494.41 })], supplierId: "cont-supplier" },
      DEFAULT_STORE_ID,
    );
    createPurchase(
      { items: [line({ taxRateCode: "exento", unitCostRef: 2494.41 })], supplierId: "cont-supplier" },
      DEFAULT_STORE_ID,
    );

    expect(lastCost("prod-drill")).toEqual({
      productId: "prod-drill",
      source: "supplier",
      taxRate: 0,
      unitCostRef: 2494.41,
    });
  });

  it("un pedido creado en la sesión no cuenta hasta que se recibe", () => {
    const order = createPurchase(
      { items: [line({ unitCostRef: 9.5 })], status: "pedido", supplierId: "cont-supplier" },
      DEFAULT_STORE_ID,
    );

    expect(lastCost("prod-drill")).toBeUndefined();

    receivePurchase(order.id, DEFAULT_STORE_ID);

    expect(lastCost("prod-drill")).toMatchObject({ source: "supplier", unitCostRef: 9.5 });
  });

  it("en modo empaque entrega el costo unitario de la línea, no el del empaque", () => {
    createPurchase(
      {
        items: [
          {
            costCurrency: "ref",
            entryMode: "pack",
            packCostRef: 17.76,
            packCostVes: 9057.6,
            packCount: 1,
            packLabel: "Bulto",
            productId: "prod-cable",
            subtotalRef: 17.76,
            subtotalVes: 9057.6,
            taxRateCode: "general",
            taxRef: 0,
            taxVes: 0,
            unitCostRef: 1.48,
            unitCostVes: 754.8,
            unitsPerPack: 12,
          },
        ],
        supplierId: "cont-supplier",
      },
      DEFAULT_STORE_ID,
    );

    expect(lastCost("prod-cable")).toMatchObject({ unitCostRef: 1.48 });
  });

  it("no repite un producto pedido dos veces", () => {
    expect(
      listPurchaseLastCosts(
        { productIds: ["prod-cable", "prod-cable"], supplierId: "cont-supplier" },
        DEFAULT_STORE_ID,
      ),
    ).toHaveLength(1);
  });
});
