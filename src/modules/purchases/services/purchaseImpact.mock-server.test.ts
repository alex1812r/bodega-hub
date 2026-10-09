/**
 * @jest-environment node
 */

import {
  mockPayments,
  mockProductPackConversions,
  mockProducts,
  mockPurchases,
  mockStockMovements,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { getPurchaseImpact, loadPurchaseImpactInputs } from "./purchaseImpact.mock-server";
import { createPurchase, getPurchaseById, receivePurchase } from "./purchases.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function addProduct(id: string, name: string, cost: number, stock: number) {
  mockProducts.push({
    categoryId: "cat-tools",
    currentCostRef: cost,
    currentStock: stock,
    id,
    isActive: true,
    minStock: 0,
    name,
    salePriceRef: 20,
    sku: id,
    storeId: DEFAULT_STORE_ID,
  });
}

function line(productId: string, quantity: number, costRef: number, marked: boolean): PurchaseItemInput {
  return {
    costCurrency: "ref",
    disassembleOnReceive: marked,
    entryMode: "unit",
    productId,
    quantity,
    subtotalRef: quantity * costRef,
    subtotalVes: quantity * costRef * 100,
    taxRateCode: "exento",
    taxRef: 0,
    taxVes: 0,
    unitCostRef: costRef,
    unitCostVes: costRef * 100,
  };
}

function productOf(id: string) {
  const product = mockProducts.find((item) => item.id === id);

  if (!product) {
    throw new Error(`Producto de prueba ausente: ${id}`);
  }

  return product;
}

describe("purchaseImpact.mock-server", () => {
  it("recibir un pedido de la semilla: cantidades, stock y costo por producto", () => {
    const impact = getPurchaseImpact("purchase-002", "receive", DEFAULT_STORE_ID);

    expect(impact).toMatchObject({
      action: "receive",
      allowed: true,
      document: { number: "C-000002", status: "pedido", statusAfter: "recibido" },
      inexact: null,
      payments: [],
    });
    expect(impact.stock.map((item) => [item.productId, item.stockBefore, item.quantityDelta, item.stockAfter])).toEqual([
      ["prod-hammer", 0, 8, 8],
      ["prod-pipe", 12, 5, 17],
      ["prod-switch", 30, 2, 32],
    ]);
    expect(impact.costs.map((item) => [item.productId, item.costRefBefore, item.costRefAfter])).toEqual([
      ["prod-hammer", 3.25, 3.25],
      ["prod-pipe", 4.8, 4.8],
      ["prod-switch", 1.2, 1.2],
    ]);
  });

  it("recibir con una línea marcada predice lo que aplica la recepción del mock", () => {
    addProduct("imp-pack", "Empaque impact", 1, 0);
    addProduct("imp-unit", "Unidad impact", 1, 4);
    mockProductPackConversions.push({
      components: [{ costWeight: 1, unitProductId: "imp-unit", unitsPerPack: 6 }],
      id: "imp-recipe",
      isActive: true,
      packProductId: "imp-pack",
      storeId: DEFAULT_STORE_ID,
      totalUnits: 6,
      unitProductId: "imp-unit",
      unitsPerPack: 6,
    });
    const purchase = createPurchase(
      {
        discountRef: 0,
        items: [line("imp-pack", 3, 9, true)],
        refRateVes: 100,
        status: "pedido",
        subtotalRef: 27,
        supplierId: "cont-supplier",
        taxRef: 0,
      },
      DEFAULT_STORE_ID,
    );
    const itemId = getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0].id;

    const impact = getPurchaseImpact(purchase.id, "receive", DEFAULT_STORE_ID);

    expect(impact.allowed).toBe(true);
    expect(impact.disassemble).toEqual([
      expect.objectContaining({
        components: [expect.objectContaining({ productId: "imp-unit", stockAfter: 22, stockBefore: 4, unitsIn: 18 })],
        packProductId: "imp-pack",
        packsOut: 3,
        purchaseItemId: itemId,
      }),
    ]);
    // Calcularlo no movió nada.
    expect([productOf("imp-pack").currentStock, productOf("imp-unit").currentStock]).toEqual([0, 4]);

    // Con `[]` la lista manda: se recibe sin desarmar.
    expect(
      getPurchaseImpact(purchase.id, "receive", DEFAULT_STORE_ID, { disassemble: [] }).stock,
    ).toEqual([expect.objectContaining({ productId: "imp-pack", quantityDelta: 3, stockAfter: 3 })]);

    receivePurchase(purchase.id, DEFAULT_STORE_ID);

    for (const predicted of impact.stock) {
      expect(productOf(predicted.productId).currentStock).toBe(predicted.stockAfter);
    }
    for (const predicted of impact.costs) {
      expect(productOf(predicted.productId).currentCostRef).toBe(predicted.costRefAfter);
    }
    // 3 empaques a 9,00 sobre 18 unidades, con las 4 que había a 1,00: (4 + 27) / 22 = 1,41.
    expect(impact.costs.map((item) => [item.productId, item.costRefAfter, item.source])).toEqual([
      ["imp-pack", 9, "purchase_line"],
      ["imp-unit", 1.41, "disassemble"],
    ]);

    // Ya recibida: el impact anticipa el rechazo.
    expect(getPurchaseImpact(purchase.id, "receive", DEFAULT_STORE_ID)).toMatchObject({
      allowed: false,
      reason: "Solo se pueden recibir compras en estado pedido",
    });
  });

  it("cancelar o devolver una compra recibida con pago activo: rechazo de la RPC y el pago que bloquea", () => {
    for (const [action, imperative] of [
      ["cancel", "cancela"],
      ["return", "devuelve"],
    ] as const) {
      const impact = getPurchaseImpact("purchase-001", action, DEFAULT_STORE_ID);

      expect(impact).toMatchObject({
        allowed: false,
        paymentsRestricted: false,
        reason: `La compra C-000001 tiene 1 pago(s) activo(s) por Bs 10200.00. Anula primero los pagos y luego ${imperative} la compra.`,
        reasonCode: "CONFLICT",
      });
      expect(impact.payments).toEqual([
        expect.objectContaining({
          amountVes: 10200,
          effects: [],
          method: "transferencia",
          outcome: "blocks_action",
          paymentId: "pay-003",
        }),
      ]);
      expect(impact.stock).toEqual([
        expect.objectContaining({ productId: "prod-cable", quantityDelta: 0, stockAfter: 4, stockBefore: 4 }),
      ]);
    }
  });

  it("sin permiso para ver pagos de compras: mismo veredicto, sin líneas", () => {
    const impact = getPurchaseImpact("purchase-001", "cancel", DEFAULT_STORE_ID, { canViewPayments: false });

    expect(impact).toMatchObject({ allowed: false, payments: [], paymentsRestricted: true });
    expect(impact.reason).toContain("1 pago(s) activo(s)");
  });

  it("cancelar un pedido sin pagos: pasa y no mueve stock", () => {
    expect(getPurchaseImpact("purchase-002", "cancel", DEFAULT_STORE_ID)).toMatchObject({
      allowed: true,
      document: { statusAfter: "cancelado" },
      stock: [],
    });
  });

  it("ya cancelada o devuelta: rechazo de estado", () => {
    for (const id of ["purchase-003", "purchase-004"]) {
      expect(getPurchaseImpact(id, "return", DEFAULT_STORE_ID)).toMatchObject({
        allowed: false,
        reason: "La compra ya fue cancelada o devuelta",
        reasonCode: "CONFLICT",
      });
    }
  });

  it("lee lo ya devuelto al proveedor de los movimientos de la compra", () => {
    expect(loadPurchaseImpactInputs("purchase-004", "return", DEFAULT_STORE_ID).returnedByProduct).toEqual({
      "prod-pipe": 4,
    });
  });

  it("404 si la compra no existe o es de otra tienda", () => {
    for (const [id, storeId] of [
      ["missing", DEFAULT_STORE_ID],
      ["purchase-001", OTHER_STORE_ID],
    ]) {
      expect(() => getPurchaseImpact(id, "cancel", storeId)).toThrow(
        expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
      );
    }
  });

  it("no tiene efectos: el mock queda igual tras pedir el impact", () => {
    const state = () => JSON.stringify([mockPurchases, mockPayments, mockProducts, mockStockMovements]);
    const before = state();

    getPurchaseImpact("purchase-002", "receive", DEFAULT_STORE_ID);
    getPurchaseImpact("purchase-001", "cancel", DEFAULT_STORE_ID);
    getPurchaseImpact("purchase-001", "return", DEFAULT_STORE_ID);

    expect(state()).toBe(before);
  });
});
