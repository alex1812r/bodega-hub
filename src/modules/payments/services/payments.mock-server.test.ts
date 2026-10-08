/**
 * @jest-environment node
 */
/**
 * PAG-06a · P4-3 en modo mock: paridad con `register_payment`. La misma clave
 * con el mismo contenido devuelve el mismo pago sin volver a abonar el
 * documento; con otro contenido se rechaza con 409.
 */

import { mockPurchases, mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createPayment, getPaymentById, type PaymentInput } from "./payments.mock-server";

const KEY_A = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const KEY_B = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const KEY_C = "1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";
const KEY_D = "2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";

const salePayment: PaymentInput = { amount: 100, method: "punto_venta", saleId: "sale-002" };
const purchasePayment: PaymentInput = {
  amount: 100,
  bankName: "Banco Nacional",
  method: "transferencia",
  purchaseId: "purchase-001",
  referenceCode: "TRX-1",
};

function salePaidVes() {
  return mockSales.find((sale) => sale.id === "sale-002")?.paidVes ?? 0;
}

function purchasePaid() {
  const purchase = mockPurchases.find((candidate) => candidate.id === "purchase-001");

  return { paidRef: purchase?.paidRef ?? 0, paidVes: purchase?.paidVes ?? 0 };
}

describe("payments.mock-server · clave de idempotencia (P4-3)", () => {
  it("pago de venta: la misma clave y el mismo contenido devuelven el mismo pago y abonan una sola vez", () => {
    const before = salePaidVes();

    const first = createPayment({ ...salePayment, clientRequestId: KEY_A }, DEFAULT_STORE_ID);
    const retry = createPayment({ ...salePayment, clientRequestId: KEY_A }, DEFAULT_STORE_ID);

    expect(retry).toBe(first);
    expect(salePaidVes()).toBe(before + 100);
  });

  it("pago de compra: el reintento no vuelve a sumar paidVes ni paidRef", () => {
    const before = purchasePaid();

    const first = createPayment({ ...purchasePayment, clientRequestId: KEY_B }, DEFAULT_STORE_ID);
    const afterFirst = purchasePaid();
    const retry = createPayment({ ...purchasePayment, clientRequestId: KEY_B }, DEFAULT_STORE_ID);

    expect(retry).toBe(first);
    expect(afterFirst.paidVes).toBe(before.paidVes + 100);
    expect(purchasePaid()).toEqual(afterFirst);
  });

  it("el orden de las propiedades del envio no cambia el contenido", () => {
    const first = createPayment(
      { amount: 5, clientRequestId: KEY_C, method: "punto_venta", saleId: "sale-002" },
      DEFAULT_STORE_ID,
    );
    const retry = createPayment(
      { saleId: "sale-002", method: "punto_venta", clientRequestId: KEY_C, amount: 5 },
      DEFAULT_STORE_ID,
    );

    expect(retry).toBe(first);
  });

  it("la misma clave con otro contenido responde 409 y no abona nada", () => {
    createPayment({ ...salePayment, clientRequestId: KEY_D }, DEFAULT_STORE_ID);
    const afterFirst = salePaidVes();

    let thrown: unknown;
    try {
      createPayment({ ...salePayment, amount: 250, clientRequestId: KEY_D }, DEFAULT_STORE_ID);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(salePaidVes()).toBe(afterFirst);
  });

  it("la clave es por tienda: en otra tienda no devuelve el pago de esta", () => {
    const here = createPayment({ ...salePayment, clientRequestId: KEY_A }, DEFAULT_STORE_ID);
    const paidHere = salePaidVes();

    expect(() => createPayment({ ...salePayment, clientRequestId: KEY_A }, "otra-tienda")).toThrow();
    expect(createPayment({ ...salePayment, clientRequestId: KEY_A }, DEFAULT_STORE_ID)).toBe(here);
    expect(salePaidVes()).toBe(paidHere);
  });

  it("sin clave cada envio registra su pago (comportamiento de siempre)", () => {
    const before = salePaidVes();

    const first = createPayment(salePayment, DEFAULT_STORE_ID);
    const second = createPayment(salePayment, DEFAULT_STORE_ID);

    expect(second).not.toBe(first);
    expect(salePaidVes()).toBe(before + 200);
  });
});

// PAG-F4 D: la fila recien insertada en `/payments` salia con el id del contacto
// porque el POST no traia `contact` ni el documento.
describe("payments.mock-server · createPayment responde como getPaymentById", () => {
  it("pago de venta: trae el contacto, el documento relacionado y su saldo", () => {
    const created = createPayment(salePayment, DEFAULT_STORE_ID);
    const detail = getPaymentById(created.id, DEFAULT_STORE_ID);

    expect(created.contact).toEqual(expect.objectContaining({ id: "cont-both" }));
    expect(created.contact?.name).toBeTruthy();
    expect(created.contact).toEqual(detail.contact);
    expect(created.relatedDocument).toEqual(detail.relatedDocument);
    expect(created.relatedDocument).toEqual(
      expect.objectContaining({ href: "/sales/sale-002" }),
    );
    expect(created.documentBalance).toEqual(detail.documentBalance);
  });

  it("pago de compra: trae el proveedor, la compra y su saldo", () => {
    const created = createPayment(purchasePayment, DEFAULT_STORE_ID);
    const detail = getPaymentById(created.id, DEFAULT_STORE_ID);

    expect(created.contact).toEqual(expect.objectContaining({ id: "cont-supplier" }));
    expect(created.contact).toEqual(detail.contact);
    expect(created.relatedDocument).toEqual(detail.relatedDocument);
    expect(created.relatedDocument).toEqual(
      expect.objectContaining({ href: "/purchases/purchase-001" }),
    );
    expect(created.documentBalance).toEqual(detail.documentBalance);
  });
});
