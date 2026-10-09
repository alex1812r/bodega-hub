/**
 * @jest-environment node
 */
/**
 * STK-511 · C6 en modo mock: la misma clave devuelve la misma compra (paridad
 * con `create_purchase`).
 */

import { listPriceReview } from "@/modules/products/services/priceReview.mock-server";
import { createProduct } from "@/modules/products/services/products.mock-server";
import { mockPayments, mockProducts, mockPurchases } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import {
  createPurchase,
  getPurchaseById,
  listPurchases,
  receivePurchase,
} from "./purchases.mock-server";

const KEY_A = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const KEY_B = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

const input = {
  discountRef: 0,
  refRateVes: 510,
  subtotalRef: 4,
  supplierId: "cont-supplier",
  taxRef: 0,
};

describe("purchases.mock-server · clave de idempotencia (C6)", () => {
  it("la misma clave devuelve la compra original", () => {
    const first = createPurchase({ ...input, clientRequestId: KEY_A }, DEFAULT_STORE_ID);
    const second = createPurchase({ ...input, clientRequestId: KEY_A }, DEFAULT_STORE_ID);

    expect(second).toBe(first);
  });

  it("otra clave, otra tienda o ninguna clave crean una compra distinta", () => {
    const first = createPurchase({ ...input, clientRequestId: KEY_A }, DEFAULT_STORE_ID);

    expect(createPurchase({ ...input, clientRequestId: KEY_B }, DEFAULT_STORE_ID)).not.toBe(first);
    expect(createPurchase({ ...input, clientRequestId: KEY_A }, "otra-tienda")).not.toBe(first);
    expect(createPurchase(input, DEFAULT_STORE_ID)).not.toBe(first);
    expect(createPurchase(input, DEFAULT_STORE_ID)).not.toBe(createPurchase(input, DEFAULT_STORE_ID));
  });
});

/**
 * PRO-10 · recibir fija el costo del producto con la regla de `create_purchase`
 * / `receive_purchase` (último costo, por unidad, con el IVA de la línea) y la
 * compra queda como causante en la cola "Por revisar".
 */
describe("purchases.mock-server · costo al recibir (PRO-10)", () => {
  let seq = 0;

  function newProduct(costRef: number, priceRef: number) {
    seq += 1;

    return createProduct(
      { currentCostRef: costRef, name: `Producto recibido ${seq}`, salePriceRef: priceRef, sku: `rec-${seq}` },
      DEFAULT_STORE_ID,
    ).id;
  }

  function unitLine(productId: string, unitCostRef: number, taxRateCode = "exento"): PurchaseItemInput {
    return {
      costCurrency: "ref",
      entryMode: "unit",
      productId,
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

  function reviewOf(purchaseId: string) {
    return listPriceReview(new URLSearchParams({ limit: "100", purchaseId }), DEFAULT_STORE_ID).items;
  }

  function costOf(productId: string) {
    return mockProducts.find((product) => product.id === productId)?.currentCostRef;
  }

  it("crear una compra recibida con costo mayor mete el producto en price-review?purchaseId", () => {
    const productId = newProduct(8, 10);
    const purchase = createPurchase({ ...input, items: [unitLine(productId, 9)] }, DEFAULT_STORE_ID);

    expect(costOf(productId)).toBe(9);
    expect(reviewOf(purchase.id)).toEqual([
      expect.objectContaining({
        currentBand: "low",
        currentCostRef: 9,
        previousBand: "high",
        previousCostRef: 8,
        productId,
        purchase: expect.objectContaining({ id: purchase.id }),
        salePriceRef: 10,
      }),
    ]);
  });

  it("un pedido no cambia el costo hasta que se recibe", () => {
    const productId = newProduct(8, 10);
    const purchase = createPurchase(
      { ...input, items: [unitLine(productId, 9)], status: "pedido" },
      DEFAULT_STORE_ID,
    );

    expect(costOf(productId)).toBe(8);
    expect(reviewOf(purchase.id)).toEqual([]);

    receivePurchase(purchase.id, DEFAULT_STORE_ID);

    expect(costOf(productId)).toBe(9);
    expect(reviewOf(purchase.id).map((item) => item.productId)).toEqual([productId]);
  });

  // PRO-F5: las compras creadas en el mock no están en la semilla `mockPurchases`.
  it("una compra creada en el mock llega a la cola con su número y su proveedor", () => {
    const productId = newProduct(8, 10);
    const purchase = createPurchase(
      { ...input, items: [unitLine(productId, 9)], purchaseNumber: "C-000777" },
      DEFAULT_STORE_ID,
    );

    expect(reviewOf(purchase.id)[0].purchase).toEqual({
      id: purchase.id,
      number: "C-000777",
      receivedAt: expect.any(String),
      supplierName: "Suministros Industriales CA",
    });
  });

  // PRO-F5: como `receive_purchase`, una compra ya recibida no se vuelve a recibir.
  it("recibir deja la compra en recibido: un segundo intento se rechaza y no reaplica el costo", () => {
    const productId = newProduct(8, 10);
    const purchase = createPurchase(
      { ...input, items: [unitLine(productId, 9)], status: "pedido" },
      DEFAULT_STORE_ID,
    );

    expect(receivePurchase(purchase.id, DEFAULT_STORE_ID).status).toBe("recibido");
    expect(getPurchaseById(purchase.id, DEFAULT_STORE_ID).status).toBe("recibido");

    // Otra compra posterior baja el costo: recibir de nuevo la primera no debe pisarlo.
    createPurchase({ ...input, items: [unitLine(productId, 7)] }, DEFAULT_STORE_ID);

    expect(() => receivePurchase(purchase.id, DEFAULT_STORE_ID)).toThrow(
      "Solo se pueden recibir compras en estado pedido.",
    );
    expect(costOf(productId)).toBe(7);
  });

  it("el costo es por unidad y con el IVA de la línea, redondeado a dinero", () => {
    const productId = newProduct(8, 10);

    createPurchase({ ...input, items: [unitLine(productId, 7.76, "general")] }, DEFAULT_STORE_ID);

    // 7,76 × 1,16 = 9,0016
    expect(costOf(productId)).toBe(9);
  });

  it("es el último costo, no un promedio: un costo menor lo baja y no entra en la cola", () => {
    const productId = newProduct(8, 10);
    const stock = mockProducts.find((product) => product.id === productId)?.currentStock;
    const purchase = createPurchase({ ...input, items: [unitLine(productId, 6)] }, DEFAULT_STORE_ID);

    expect(costOf(productId)).toBe(6);
    expect(reviewOf(purchase.id)).toEqual([]);
    expect(mockProducts.find((product) => product.id === productId)?.currentStock).toBe(stock);
  });

  it("una línea por empaque fija el costo por unidad; si el producto es el empaque de un par, el del empaque", () => {
    const unitProductId = newProduct(1, 2);
    const packLine = (productId: string): PurchaseItemInput => ({
      ...unitLine(productId, 1.5),
      entryMode: "pack",
      packCostRef: 15,
      packCostVes: 7650,
      packCount: 1,
      packLabel: "Caja",
      unitsPerPack: 10,
    });

    createPurchase(
      { ...input, items: [packLine(unitProductId), packLine("prod-cigar-pack")] },
      DEFAULT_STORE_ID,
    );

    expect(costOf(unitProductId)).toBe(1.5);
    expect(costOf("prod-cigar-pack")).toBe(15);
  });
});

/**
 * COM-16 · paridad con `purchases.server`: sin permiso para ver pagos de compras
 * el detalle no lleva los pagos individuales; lo pagado es el de la cabecera.
 */
describe("purchases.mock-server · pagos del detalle por acceso (COM-16)", () => {
  const PURCHASE_ID = "purchase-001";
  const header = () => mockPurchases.find((purchase) => purchase.id === PURCHASE_ID);
  const seedPaymentIds = () =>
    mockPayments.filter((payment) => payment.purchaseId === PURCHASE_ID).map((payment) => payment.id);

  it("sin acceso: `payments: []` y Pagado de la cabecera; el resto del detalle no cambia", () => {
    const full = getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID);
    const restricted = getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID, { canViewPayments: false });

    expect(seedPaymentIds().length).toBeGreaterThan(0);
    expect(restricted.payments).toEqual([]);
    expect(restricted.paidVes).toBe(header()?.paidVes);
    expect(restricted.paidVes).toBeGreaterThan(0);
    expect(restricted.paidRef).toBe(full.paidRef);
    expect({ ...restricted, payments: full.payments }).toEqual(full);
  });

  it.each([
    ["acceso explícito", { canViewPayments: true }],
    ["acceso por defecto", undefined],
  ] as const)("con %s: los pagos de la compra con su contacto, como antes", (_label, access) => {
    const detail = getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID, access);

    expect(detail.payments.map((payment) => payment.id)).toEqual(seedPaymentIds());
    expect(detail.payments.every((payment) => payment.contact?.id === payment.contactId)).toBe(true);
    expect(detail.paidVes).toBe(header()?.paidVes);
  });
});

/**
 * COM-F2 · la semilla no trae `paidRef` en la cabecera: lo pagado de una compra
 * del mock sale de sus pagos activos, igual en el detalle (con o sin permiso
 * para ver pagos) y en el listado.
 */
describe("purchases.mock-server · pagado coherente con los pagos activos (COM-F2)", () => {
  const listed = (id: string) =>
    listPurchases(new URLSearchParams("limit=100"), DEFAULT_STORE_ID).items.find(
      (purchase) => purchase.id === id,
    );

  it.each([
    ["con permiso", { canViewPayments: true }],
    ["sin permiso", { canViewPayments: false }],
  ] as const)("detalle %s: purchase-001 está pagada entera en REF y en Bs", (_label, access) => {
    const detail = getPurchaseById("purchase-001", DEFAULT_STORE_ID, access);

    expect(detail.paidRef).toBe(20);
    expect(detail.paidVes).toBe(10200);
    expect(detail.totalRef - detail.paidRef).toBe(0);
  });

  it("detalle: un abono parcial deja el pagado en la suma de sus pagos", () => {
    const detail = getPurchaseById("purchase-004", DEFAULT_STORE_ID);

    expect(detail.paidRef).toBe(5.02);
    expect(detail.paidVes).toBe(2500);
  });

  it("detalle: una compra sin pagos lleva pagado 0, no `undefined`", () => {
    const detail = getPurchaseById("purchase-002", DEFAULT_STORE_ID);

    expect(detail.paidRef).toBe(0);
    expect(detail.paidVes).toBe(0);
  });

  it("listado: cada compra lleva el mismo pagado que su detalle", () => {
    for (const id of ["purchase-001", "purchase-002", "purchase-004"]) {
      const detail = getPurchaseById(id, DEFAULT_STORE_ID);

      expect(listed(id)).toEqual(
        expect.objectContaining({ paidRef: detail.paidRef, paidVes: detail.paidVes }),
      );
    }
  });

  it("un pago anulado no cuenta como pagado", () => {
    const payment = mockPayments.find((candidate) => candidate.purchaseId === "purchase-001");

    if (!payment) {
      throw new Error("La semilla debe traer un pago de purchase-001.");
    }

    const previousStatus = payment.status;
    payment.status = "anulado";

    try {
      expect(getPurchaseById("purchase-001", DEFAULT_STORE_ID).paidRef).toBe(0);
      expect(listed("purchase-001")?.paidVes).toBe(0);
    } finally {
      payment.status = previousStatus;
    }
  });
});
