/**
 * @jest-environment node
 */
/**
 * COM-06 · pago inicial opcional en `POST /api/purchases`: se valida y se autoriza
 * todo antes de crear nada; después, compra y pago en secuencia, cada uno con su
 * clave de idempotencia. Un pago que falla deja la compra creada y pendiente.
 */

import { ApiError } from "@/lib/api/apiError";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import { mockPayments } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

jest.mock("../../../modules/purchases/services/purchases.mock-server", () => {
  const actual = jest.requireActual<
    typeof import("../../../modules/purchases/services/purchases.mock-server")
  >("../../../modules/purchases/services/purchases.mock-server");

  return { ...actual, createPurchase: jest.fn(actual.createPurchase) };
});
jest.mock("../../../modules/payments/services/payments.mock-server", () => {
  const actual = jest.requireActual<
    typeof import("../../../modules/payments/services/payments.mock-server")
  >("../../../modules/payments/services/payments.mock-server");

  return { ...actual, createPayment: jest.fn(actual.createPayment) };
});

const createPurchase = jest.mocked(purchasesMockServer.createPurchase);
const createPayment = jest.mocked(paymentsMockServer.createPayment);

const PURCHASE_KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const PAYMENT_KEY = "8b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";
const OTHER_PURCHASE_KEY = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const OTHER_PAYMENT_KEY = "0d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a";

const purchase = {
  discountRef: 0,
  discountVes: 0,
  items: [
    {
      costCurrency: "ref",
      entryMode: "unit",
      productId: "prod-cable",
      quantity: 2,
      subtotalRef: 4,
      subtotalVes: 2040,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 2,
      unitCostVes: 1020,
    },
  ],
  refRateVes: 510,
  subtotalRef: 4,
  subtotalVes: 2040,
  supplierId: "cont-supplier",
  taxRef: 0,
  taxVes: 0,
};

const transfer = {
  amount: 2040,
  bankName: "Banco de Venezuela",
  currency: "VES",
  method: "transferencia",
  referenceCode: "TRX-001",
};

function post(body: unknown, role = "admin") {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
  );
}

function paymentsOf(purchaseId: string) {
  return mockPayments.filter((payment) => payment.purchaseId === purchaseId);
}

describe("POST /api/purchases · pago inicial (COM-06)", () => {
  beforeEach(() => {
    createPurchase.mockClear();
    createPayment.mockClear();
  });

  it("sin initialPayment responde la compra como antes, sin la clave initialPayment", async () => {
    const response = await post(purchase);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).not.toHaveProperty("initialPayment");
    expect(createPayment).not.toHaveBeenCalled();
  });

  it.each([
    ["transferencia sin banco ni referencia", { amount: 100, method: "transferencia" }],
    ["monto cero", { ...transfer, amount: 0 }],
    ["vuelto en un pago de compra", { ...transfer, change: { amount: 5, method: "efectivo_ves" } }],
  ])("pago inválido (%s) → 400 y no se crea nada", async (_caso, payment) => {
    const response = await post({
      ...purchase,
      clientRequestId: PURCHASE_KEY,
      initialPayment: { ...payment, clientRequestId: PAYMENT_KEY },
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(createPurchase).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("el pago inicial exige su propia clave de idempotencia", async () => {
    const response = await post({ ...purchase, initialPayment: transfer });

    expect(response.status).toBe(400);
    expect(createPurchase).not.toHaveBeenCalled();
  });

  it("sin permiso de registrar pagos (almacén) → 403 y no se crea nada", async () => {
    const response = await post(
      {
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        initialPayment: { ...transfer, clientRequestId: PAYMENT_KEY },
      },
      "almacen",
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.message).toBe("No tienes permiso para registrar pagos de compras.");
    expect(createPurchase).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("OK → compra + pago registrado; el detalle la muestra pagada. El reintento con las mismas claves devuelve los mismos ids sin duplicar", async () => {
    const body = {
      ...purchase,
      clientRequestId: PURCHASE_KEY,
      initialPayment: { ...transfer, clientRequestId: PAYMENT_KEY },
      status: "pedido",
    };

    const first = await post(body);
    const firstPayload = await first.json();

    expect(first.status).toBe(201);
    expect(firstPayload.data).toMatchObject({
      initialPayment: { paymentId: expect.any(String), status: "registered" },
      status: "pedido",
      totalVes: 2040,
    });

    const purchaseId: string = firstPayload.data.id;
    const paymentId: string = firstPayload.data.initialPayment.paymentId;

    expect(createPayment).toHaveBeenCalledWith(
      { ...transfer, clientRequestId: PAYMENT_KEY, purchaseId },
      DEFAULT_STORE_ID,
    );

    const retry = await post(body);
    const retryPayload = await retry.json();

    expect(retry.status).toBe(201);
    expect(retryPayload.data.id).toBe(purchaseId);
    expect(retryPayload.data.initialPayment).toEqual({ paymentId, status: "registered" });
    // 1 compra y 1 pago en el mock.
    expect(new Set(createPurchase.mock.results.map((result) => result.value.id)).size).toBe(1);
    expect(paymentsOf(purchaseId).map((payment) => payment.id)).toEqual([paymentId]);

    const detail = purchasesMockServer.getPurchaseById(purchaseId, DEFAULT_STORE_ID);

    expect(detail.paidVes).toBe(2040);
    expect(detail.payments).toHaveLength(1);
  });

  it("el pago falla por una regla de negocio → 201 con la compra y failed + el mensaje del servidor", async () => {
    createPayment.mockImplementationOnce(() => {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta",
      );
    });

    const response = await post({
      ...purchase,
      clientRequestId: OTHER_PURCHASE_KEY,
      initialPayment: { ...transfer, clientRequestId: OTHER_PAYMENT_KEY },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.id).toEqual(expect.any(String));
    expect(payload.data.initialPayment).toEqual({
      message: "No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta",
      status: "failed",
    });
    // Nunca un pago sin compra: la compra existe y queda sin pagos.
    expect(paymentsOf(payload.data.id)).toHaveLength(0);
    expect(purchasesMockServer.getPurchaseById(payload.data.id, DEFAULT_STORE_ID).paidVes).toBe(0);

    // Reintento del mismo intento: misma compra y, ahora sí, el pago entra una vez.
    const retry = await post({
      ...purchase,
      clientRequestId: OTHER_PURCHASE_KEY,
      initialPayment: { ...transfer, clientRequestId: OTHER_PAYMENT_KEY },
    });
    const retryPayload = await retry.json();

    expect(retryPayload.data.id).toBe(payload.data.id);
    expect(retryPayload.data.initialPayment.status).toBe("registered");
    expect(paymentsOf(payload.data.id)).toHaveLength(1);
  });

  it("el pago falla sin respuesta clara (red, 5xx) → failed con el aviso de resultado incierto", async () => {
    createPayment.mockImplementationOnce(() => {
      throw new TypeError("fetch failed");
    });

    const response = await post({
      ...purchase,
      initialPayment: { ...transfer, clientRequestId: "1e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b" },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.initialPayment).toEqual({
      message:
        "No pudimos confirmar si el pago se registró. Revisa los pagos de la compra antes de registrarlo de nuevo.",
      status: "failed",
    });
  });
});
