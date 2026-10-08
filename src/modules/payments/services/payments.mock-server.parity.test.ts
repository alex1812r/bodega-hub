/**
 * @jest-environment node
 */
/**
 * PAG-F3 · modo mock con paridad con `register_payment` / `cancel_payment`: el
 * pago registrado queda guardado (lista, detalle del documento), la venta sigue
 * la regla de estado de la RPC y anularlo revierte saldo y estado.
 */

import { getPurchaseById } from "@/modules/purchases/services/purchases.mock-server";
import { getSaleById } from "@/modules/sales/services/sales.mock-server";
import { mockPurchases, mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  cancelPayment,
  createPayment,
  getPaymentById,
  listPayments,
} from "./payments.mock-server";

const SALE_ID = "sale-002"; // pendiente_pago · total 11.475 · pagado 3.000
const PURCHASE_ID = "purchase-002"; // pedido · total 26.724 · pagado 0 · tasa 510
const KEY = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";

function sale(id = SALE_ID) {
  const found = mockSales.find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error(`Falta la venta ${id} en la semilla`);
  }

  return found;
}

function purchase() {
  const found = mockPurchases.find((candidate) => candidate.id === PURCHASE_ID);

  if (!found) {
    throw new Error(`Falta la compra ${PURCHASE_ID} en la semilla`);
  }

  return found;
}

function listed(query: string) {
  return listPayments(new URLSearchParams(`${query}&limit=100`), DEFAULT_STORE_ID).items;
}

describe("payments.mock-server · el pago registrado queda guardado (PAG-F3)", () => {
  it("pago de compra: aparece en la lista con su contacto y su documento", () => {
    const payment = createPayment(
      {
        amount: 1000,
        bankName: "Banco Nacional",
        method: "transferencia",
        notes: "Abono de prueba",
        purchaseId: PURCHASE_ID,
        referenceCode: "TRX-PARIDAD",
      },
      DEFAULT_STORE_ID,
    );

    const row = listed(`purchaseId=${PURCHASE_ID}`).find((item) => item.id === payment.id);

    expect(row).toMatchObject({
      amountVes: 1000,
      bankName: "Banco Nacional",
      contact: { id: "cont-both" },
      direction: "salida",
      notes: "Abono de prueba",
      purchaseId: PURCHASE_ID,
      referenceCode: "TRX-PARIDAD",
      relatedDocument: { href: `/purchases/${PURCHASE_ID}` },
      status: "activo",
    });
    expect(listed("direction=salida").map((item) => item.id)).toContain(payment.id);
  });

  it("pago de compra: aparece en el historial del detalle de la compra", () => {
    const payment = createPayment(
      { amount: 500, method: "efectivo_ves", purchaseId: PURCHASE_ID },
      DEFAULT_STORE_ID,
    );

    const detail = getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID);

    expect(detail.payments.find((item) => item.id === payment.id)).toMatchObject({
      amountVes: 500,
      contact: { id: "cont-both" },
    });
  });

  it("pago de venta: aparece en la lista y en el detalle de la venta", () => {
    const payment = createPayment(
      { amount: 100, method: "punto_venta", saleId: SALE_ID },
      DEFAULT_STORE_ID,
    );

    expect(listed(`saleId=${SALE_ID}`).find((item) => item.id === payment.id)).toMatchObject({
      contact: { id: "cont-both" },
      direction: "entrada",
      relatedDocument: { href: `/sales/${SALE_ID}`, label: "V-000002" },
    });
    expect(
      getSaleById(SALE_ID, DEFAULT_STORE_ID).payments.map((item) => item.id),
    ).toContain(payment.id);
    expect(getPaymentById(payment.id, DEFAULT_STORE_ID).id).toBe(payment.id);
  });

  it("dos pagos en el mismo instante tienen ids distintos y se anulan por separado", () => {
    const first = createPayment(
      { amount: 10, method: "punto_venta", saleId: SALE_ID },
      DEFAULT_STORE_ID,
    );
    const second = createPayment(
      { amount: 20, method: "punto_venta", saleId: SALE_ID },
      DEFAULT_STORE_ID,
    );

    expect(second.id).not.toBe(first.id);

    const before = sale().paidVes;

    cancelPayment(second.id, DEFAULT_STORE_ID);

    expect(sale().paidVes).toBe(before - 20);
    expect(getPaymentById(first.id, DEFAULT_STORE_ID).status).toBe("activo");
    expect(getPaymentById(second.id, DEFAULT_STORE_ID).status).toBe("anulado");
  });
});

describe("payments.mock-server · estado de la venta como `register_payment` (PAG-F3)", () => {
  it("un abono que no salda deja la venta en pendiente_pago", () => {
    createPayment({ amount: 50.25, method: "punto_venta", saleId: SALE_ID }, DEFAULT_STORE_ID);

    expect(sale().paidVes).toBeLessThan(sale().totalVes);
    expect(sale().status).toBe("pendiente_pago");
  });

  it("el pago que salda la venta la pasa a pagada y anularlo la devuelve a pendiente_pago", () => {
    const paidBefore = sale().paidVes;
    const pending = Math.round((sale().totalVes - paidBefore) * 100) / 100;

    const payment = createPayment(
      { amount: pending, method: "punto_venta", saleId: SALE_ID },
      DEFAULT_STORE_ID,
    );

    expect(sale().paidVes).toBe(sale().totalVes);
    expect(sale().status).toBe("pagada");
    expect(getSaleById(SALE_ID, DEFAULT_STORE_ID).status).toBe("pagada");

    const cancelled = cancelPayment(payment.id, DEFAULT_STORE_ID);

    expect(cancelled.status).toBe("anulado");
    expect(sale().paidVes).toBe(paidBefore);
    expect(sale().status).toBe("pendiente_pago");
    expect(
      listed(`saleId=${SALE_ID}`).find((item) => item.id === payment.id)?.status,
    ).toBe("anulado");
  });

  it("no toca el estado de una venta cancelada, devuelta o en borrador", () => {
    for (const id of ["sale-003", "sale-004", "sale-005"]) {
      const statusBefore = sale(id).status;

      createPayment({ amount: 1, method: "punto_venta", saleId: id }, DEFAULT_STORE_ID);

      expect(sale(id).status).toBe(statusBefore);
    }
  });
});

describe("payments.mock-server · anular revierte como `cancel_payment` (PAG-F3)", () => {
  it("pago de compra en USD: devuelve paidVes y paidRef a su valor anterior", () => {
    const before = { paidRef: purchase().paidRef ?? 0, paidVes: purchase().paidVes };

    const payment = createPayment(
      { amount: 3.33, currency: "USD", method: "efectivo_usd", purchaseId: PURCHASE_ID },
      DEFAULT_STORE_ID,
    );

    expect(purchase().paidVes).toBe(Math.round((before.paidVes + 3.33 * 510) * 100) / 100);

    cancelPayment(payment.id, DEFAULT_STORE_ID);

    expect({ paidRef: purchase().paidRef, paidVes: purchase().paidVes }).toEqual(before);
    expect(
      getPurchaseById(PURCHASE_ID, DEFAULT_STORE_ID).payments.find(
        (item) => item.id === payment.id,
      )?.status,
    ).toBe("anulado");
  });

  it("pago de venta con centimos: el saldo vuelve exacto, sin restos de coma flotante", () => {
    const before = sale().paidVes;

    const first = createPayment(
      { amount: 0.1, method: "punto_venta", saleId: SALE_ID },
      DEFAULT_STORE_ID,
    );
    const second = createPayment(
      { amount: 0.2, method: "punto_venta", saleId: SALE_ID },
      DEFAULT_STORE_ID,
    );

    cancelPayment(first.id, DEFAULT_STORE_ID);
    cancelPayment(second.id, DEFAULT_STORE_ID);

    expect(sale().paidVes).toBe(before);
  });

  it("reintentar con la clave de un pago ya anulado responde 409 y no abona", () => {
    const input = { amount: 15, clientRequestId: KEY, method: "punto_venta", saleId: SALE_ID } as const;
    const payment = createPayment(input, DEFAULT_STORE_ID);

    cancelPayment(payment.id, DEFAULT_STORE_ID);

    const paidAfterCancel = sale().paidVes;
    let thrown: unknown;

    try {
      createPayment(input, DEFAULT_STORE_ID);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(sale().paidVes).toBe(paidAfterCancel);
  });
});
