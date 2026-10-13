/**
 * @jest-environment node
 *
 * GQ-06 · `getPurchaseById` traía los pagos por defecto (`canViewPayments: true`):
 * las rutas que devuelven la compra tras recibir, anular o devolver no pasaban el
 * permiso y le entregaban los pagos a quien no puede verlos (almacén). Ahora el
 * detalle es cerrado por defecto y cada ruta dice qué puede ver su usuario.
 */

import { getPurchaseById } from "@/modules/purchases/services/purchases.mock-server";
import { mockPayments } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PATCH as cancel } from "./cancel/route";
import { PATCH as receive } from "./receive/route";
import { POST as returnPurchase } from "./return/route";

type PurchaseBody = { payments: Array<{ id: string }>; status: string };

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function paymentIdsOf(purchaseId: string) {
  return mockPayments
    .filter((payment) => payment.purchaseId === purchaseId)
    .map((payment) => payment.id);
}

function mutation(
  action: string,
  id: string,
  role: string,
  method = "PATCH",
  body?: unknown,
) {
  return new Request(`http://localhost/api/purchases/${id}/${action}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json", "x-demo-role": role },
    method,
  });
}

/** Misma clave e igual contenido: la segunda recepción devuelve la compra ya recibida. */
const RECEIVE_REQUEST = { clientRequestId: "6f0e6a3e-3c1b-4f0e-9d53-0a6f6c0a9e11" };

const mutations: Array<
  [string, string, (role: string) => Promise<PurchaseBody>]
> = [
  [
    "anular",
    "purchase-001",
    async (role) =>
      (
        await (
          await cancel(
            mutation("cancel", "purchase-001", role),
            context("purchase-001"),
          )
        ).json()
      ).data,
  ],
  [
    "devolver",
    "purchase-001",
    async (role) =>
      (
        await (
          await returnPurchase(
            mutation("return", "purchase-001", role, "POST"),
            context("purchase-001"),
          )
        ).json()
      ).data.purchase,
  ],
  [
    "recibir",
    "purchase-002",
    async (role) =>
      (
        await (
          await receive(
            mutation("receive", "purchase-002", role, "PATCH", RECEIVE_REQUEST),
            context("purchase-002"),
          )
        ).json()
      ).data,
  ],
];

describe("pagos en el detalle de compra: cerrado por defecto (GQ-06)", () => {
  const seedLength = mockPayments.length;

  beforeAll(() => {
    // El pedido de la semilla no tiene pagos: se le añade un abono para la prueba.
    const seed = mockPayments.find(
      (payment) => payment.purchaseId === "purchase-001",
    );

    if (seed) {
      mockPayments.push({
        ...seed,
        id: "pay-gq06-pedido",
        purchaseId: "purchase-002",
      });
    }
  });

  afterAll(() => {
    mockPayments.length = seedLength;
  });

  it("la semilla tiene pagos en las dos compras de la prueba", () => {
    expect(paymentIdsOf("purchase-001").length).toBeGreaterThan(0);
    expect(paymentIdsOf("purchase-002").length).toBeGreaterThan(0);
  });

  it("getPurchaseById sin decir quién mira no trae pagos; con permiso explícito, sí", () => {
    expect(getPurchaseById("purchase-001", DEFAULT_STORE_ID).payments).toEqual(
      [],
    );
    expect(
      getPurchaseById("purchase-001", DEFAULT_STORE_ID, {
        canViewPayments: true,
      }).payments.map((payment) => payment.id),
    ).toEqual(paymentIdsOf("purchase-001"));
  });

  describe.each(mutations)("%s", (_name, purchaseId, run) => {
    it("almacén recibe la compra sin sus pagos", async () => {
      expect((await run("almacen")).payments).toEqual([]);
    });

    it("admin recibe la compra con sus pagos", async () => {
      expect(
        (await run("admin")).payments.map((payment) => payment.id),
      ).toEqual(paymentIdsOf(purchaseId));
    });
  });
});
