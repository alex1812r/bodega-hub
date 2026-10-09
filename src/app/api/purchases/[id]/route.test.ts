/**
 * @jest-environment node
 */

import { mockPayments, mockPurchases } from "@/shared/mocks/erp-data";

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

function getPurchase(id: string, role: string) {
  return GET(
    new Request(`http://localhost/api/purchases/${id}`, {
      headers: { "x-demo-role": role },
    }),
    context(id),
  );
}

describe("/api/purchases/[id]", () => {
  it("returns purchase details", async () => {
    const response = await getPurchase("purchase-001", "almacen");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        id: "purchase-001",
        items: expect.any(Array),
        payments: expect.any(Array),
      }),
    );
  });

  it("returns not found for missing purchase", async () => {
    const response = await getPurchase("missing", "almacen");

    expect(response.status).toBe(404);
  });

  // COM-16: los pagos individuales de una compra son de quien puede ver pagos de compras.
  describe("pagos de la compra por rol (COM-16)", () => {
    const header = mockPurchases.find((purchase) => purchase.id === "purchase-001");
    const paymentIds = mockPayments
      .filter((payment) => payment.purchaseId === "purchase-001")
      .map((payment) => payment.id);

    it("la semilla tiene al menos un pago de la compra", () => {
      expect(paymentIds.length).toBeGreaterThan(0);
    });

    it.each(["admin", "contador"])("%s recibe los pagos de la compra", async (role) => {
      const body = await (await getPurchase("purchase-001", role)).json();

      expect(body.data.payments.map((payment: { id: string }) => payment.id)).toEqual(paymentIds);
      expect(body.data.paidVes).toBe(header?.paidVes);
    });

    it("almacen no recibe los pagos, pero si lo pagado de la cabecera", async () => {
      const response = await getPurchase("purchase-001", "almacen");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.payments).toEqual([]);
      expect(body.data.paidVes).toBe(header?.paidVes);
      expect(body.data.paidVes).toBeGreaterThan(0);
      expect(body.data.items.length).toBeGreaterThan(0);
    });

    it("vendedor sigue sin acceso a la compra", async () => {
      expect((await getPurchase("purchase-001", "vendedor")).status).toBe(403);
    });
  });
});
