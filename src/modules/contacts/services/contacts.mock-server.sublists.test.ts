/**
 * DET-04 (D24) · sublistas del contacto en el mock: paginan con `skip`/`limit`
 * y van de lo más reciente a lo más antiguo, como el servidor real.
 */
import { mockPayments, type PaymentMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  getContactActivity,
  getContactPayments,
  getContactPurchases,
  getContactSales,
} from "./contacts.mock-server";

const CONTACT_ID = "cont-customer";
const EXTRA_PAYMENTS = 25;

function params(query = "") {
  return new URLSearchParams(query);
}

function isNewestFirst(rows: { createdAt: string }[]) {
  return rows.every(
    (row, index) => index === 0 || rows[index - 1].createdAt.localeCompare(row.createdAt) >= 0,
  );
}

describe("contacts.mock-server · sublistas paginadas", () => {
  const initialLength = mockPayments.length;

  beforeEach(() => {
    for (let index = 0; index < EXTRA_PAYMENTS; index += 1) {
      mockPayments.push({
        amount: 100,
        amountRef: 1,
        amountVes: 100,
        contactId: CONTACT_ID,
        // Años distintos: el orden no depende de los pagos de la semilla.
        createdAt: `20${String(30 + index)}-01-01T10:00:00.000Z`,
        direction: "entrada",
        id: `pay-det04-${index}`,
        method: "efectivo_ves",
        refRateVes: 100,
        storeId: DEFAULT_STORE_ID,
      } satisfies PaymentMock);
    }
  });

  afterEach(() => {
    mockPayments.length = initialLength;
  });

  it("pagos: la página 2 trae las filas 11 a 20, sin repetir las de la primera", () => {
    const first = getContactPayments(CONTACT_ID, params(), DEFAULT_STORE_ID);
    const second = getContactPayments(CONTACT_ID, params("skip=10&limit=10"), DEFAULT_STORE_ID);

    expect(first.total).toBeGreaterThanOrEqual(EXTRA_PAYMENTS);
    expect(second.total).toBe(first.total);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(second.skip).toBe(10);
    // El más reciente es el último añadido (año 2054).
    expect(first.items[0].id).toBe(`pay-det04-${EXTRA_PAYMENTS - 1}`);
    expect(second.items[0].id).toBe(`pay-det04-${EXTRA_PAYMENTS - 11}`);

    const firstIds = new Set(first.items.map((item) => item.id));

    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);
  });

  // GQ-05: la pestaña «Pagos» del contacto nombra el documento por su número.
  it("pagos: cada pago trae el número y el enlace de su venta o compra", () => {
    const all = params("limit=100");
    const ofSales = mockPayments.find((payment) => payment.saleId === "sale-001");
    const ofPurchases = mockPayments.find((payment) => payment.purchaseId === "purchase-001");
    const salePayment = getContactPayments(ofSales?.contactId ?? "", all, DEFAULT_STORE_ID).items.find(
      (payment) => payment.id === ofSales?.id,
    );
    const purchasePayment = getContactPayments(
      ofPurchases?.contactId ?? "",
      all,
      DEFAULT_STORE_ID,
    ).items.find((payment) => payment.id === ofPurchases?.id);

    expect(salePayment?.relatedDocument).toEqual({
      href: "/sales/sale-001",
      label: expect.stringMatching(/^V-/),
    });
    expect(purchasePayment?.relatedDocument).toEqual({
      href: "/purchases/purchase-001",
      label: expect.stringMatching(/^#C-/),
    });
  });

  it("pagos: más allá del final no hay filas y el total se conserva", () => {
    const beyond = getContactPayments(CONTACT_ID, params("skip=99980&limit=10"), DEFAULT_STORE_ID);

    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBeGreaterThanOrEqual(EXTRA_PAYMENTS);
  });

  it("actividad: la página 1 es lo más reciente y pagina igual", () => {
    const first = getContactActivity(CONTACT_ID, params(), DEFAULT_STORE_ID);
    const second = getContactActivity(CONTACT_ID, params("skip=10&limit=10"), DEFAULT_STORE_ID);
    const all = getContactActivity(CONTACT_ID, params("limit=100"), DEFAULT_STORE_ID);

    expect(first.items[0]).toMatchObject({
      id: `pay-det04-${EXTRA_PAYMENTS - 1}`,
      type: "payment",
    });
    expect(isNewestFirst(all.items)).toBe(true);
    expect(second.items).toEqual(all.items.slice(10, 20));
  });

  it("ventas, compras y pagos van de lo más reciente a lo más antiguo", () => {
    const limit = params("limit=100");

    expect(isNewestFirst(getContactSales(CONTACT_ID, limit, DEFAULT_STORE_ID).items)).toBe(true);
    expect(isNewestFirst(getContactPayments(CONTACT_ID, limit, DEFAULT_STORE_ID).items)).toBe(true);
    expect(isNewestFirst(getContactPurchases("cont-supplier", limit, DEFAULT_STORE_ID).items)).toBe(
      true,
    );
  });
});
