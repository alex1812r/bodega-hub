/**
 * @jest-environment node
 */

import {
  mockContacts,
  mockPurchases,
  mockSales,
  type ContactMock,
  type PurchaseMock,
  type SaleMock,
} from "@/shared/mocks/erp-data";

import {
  buildOpenDocument,
  listOpenDocuments,
  resolveOpenDocumentsDateRange,
  type OpenDocumentsQuery,
} from "./openDocuments.mock-server";

const STORE_ID = "store-open-documents-test";
// 2026-06-20 10:00 en Caracas.
const NOW = new Date("2026-06-20T14:00:00.000Z");

function contact(id: string, name: string, taxId: string, type: ContactMock["type"]): ContactMock {
  return { address: "", email: "", id, isActive: true, name, phone: "", storeId: STORE_ID, taxId, type };
}

function sale(overrides: Partial<SaleMock> & Pick<SaleMock, "id">): SaleMock {
  return {
    createdAt: "2026-06-10T15:00:00.000Z",
    customerId: "od-customer-a",
    discountRef: 0,
    invoiceNumber: `V-${overrides.id}`,
    paidVes: 0,
    refRateVes: 100,
    status: "pendiente_pago",
    storeId: STORE_ID,
    subtotalRef: 10,
    taxRef: 0,
    totalRef: 10,
    totalVes: 1000,
    userId: "user-seller",
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseMock> & Pick<PurchaseMock, "id">): PurchaseMock {
  return {
    createdAt: "2026-06-05T15:00:00.000Z",
    discountRef: 0,
    paidVes: 0,
    purchaseNumber: `C-${overrides.id}`,
    refRateVes: 100,
    status: "recibido",
    storeId: STORE_ID,
    subtotalRef: 20,
    supplierId: "od-supplier",
    taxRef: 0,
    totalRef: 20,
    totalVes: 2000,
    userId: "user-warehouse",
    ...overrides,
  };
}

const contacts = [
  contact("od-customer-a", "Panadería Ávila", "J-11111111-1", "cliente"),
  contact("od-customer-b", "Bodega Sin Rif", "", "cliente"),
  contact("od-supplier", "Distribuidora Norte", "J-22222222-2", "proveedor"),
];

const sales = [
  sale({ createdAt: "2026-06-18T15:00:00.000Z", id: "od-sale-new", invoiceNumber: "V-900003" }),
  sale({
    createdAt: "2026-06-01T15:00:00.000Z",
    id: "od-sale-old",
    invoiceNumber: "V-900001",
    paidVes: 400.4,
    totalVes: 1000.5,
  }),
  sale({
    createdAt: "2026-06-10T15:00:00.000Z",
    customerId: "od-customer-b",
    id: "od-sale-mid",
    invoiceNumber: "V-900002",
  }),
  sale({ id: "od-sale-paid", paidVes: 1000, status: "pagada" }),
  sale({ id: "od-sale-overpaid", paidVes: 1000.004, status: "pendiente_pago" }),
  sale({ id: "od-sale-cancelled", status: "cancelada" }),
  sale({ id: "od-sale-returned", status: "devuelta" }),
  sale({ id: "od-sale-draft", status: "borrador" }),
  sale({ id: "od-sale-other-store", storeId: "store-somewhere-else" }),
];

const purchases = [
  purchase({ id: "od-purchase-open", paidRef: 5, paidVes: 500, purchaseNumber: "C-900001" }),
  purchase({
    createdAt: "2026-06-12T15:00:00.000Z",
    id: "od-purchase-ordered",
    purchaseNumber: "C-900002",
    status: "pedido",
  }),
  purchase({ id: "od-purchase-paid", paidRef: 20, paidVes: 2000 }),
  purchase({ id: "od-purchase-cancelled", status: "cancelado" }),
  purchase({ id: "od-purchase-returned", status: "devuelto" }),
];

function query(overrides: Partial<OpenDocumentsQuery> = {}): OpenDocumentsQuery {
  return { limit: 100, skip: 0, types: ["sale", "purchase"], ...overrides };
}

async function listIds(overrides: Partial<OpenDocumentsQuery> = {}) {
  const result = await listOpenDocuments(query(overrides), STORE_ID, NOW);
  return result.items.map((item) => item.id);
}

describe("openDocuments.mock-server", () => {
  beforeAll(() => {
    mockContacts.push(...contacts);
    mockSales.push(...sales);
    mockPurchases.push(...purchases);
  });

  afterAll(() => {
    const remove = <T extends { id: string }>(list: T[], added: T[]) => {
      added.forEach((entry) => {
        const index = list.findIndex((candidate) => candidate.id === entry.id);
        if (index >= 0) {
          list.splice(index, 1);
        }
      });
    };

    remove(mockContacts, contacts);
    remove(mockSales, sales);
    remove(mockPurchases, purchases);
  });

  it("lists only documents with balance of the store, oldest first", async () => {
    expect(await listIds()).toEqual([
      "od-sale-old",
      "od-purchase-open",
      "od-sale-mid",
      "od-purchase-ordered",
      "od-sale-new",
    ]);
  });

  it("excludes paid, cancelled, returned and draft documents", async () => {
    const ids = await listIds();

    [
      "od-sale-paid",
      "od-sale-overpaid",
      "od-sale-cancelled",
      "od-sale-returned",
      "od-sale-draft",
      "od-sale-other-store",
      "od-purchase-paid",
      "od-purchase-cancelled",
      "od-purchase-returned",
    ].forEach((id) => expect(ids).not.toContain(id));
  });

  it("returns the sale shape with the balance rounded like the detail", async () => {
    const result = await listOpenDocuments(query({ types: ["sale"] }), STORE_ID, NOW);

    expect(result.items[0]).toEqual({
      contact: { id: "od-customer-a", name: "Panadería Ávila", taxId: "J-11111111-1" },
      createdAt: "2026-06-01T15:00:00.000Z",
      id: "od-sale-old",
      number: "V-900001",
      paidVes: 400.4,
      pendingRef: 6,
      pendingVes: 600.1,
      refRateVes: 100,
      status: "pendiente_pago",
      totalRef: 10,
      totalVes: 1000.5,
      type: "sale",
    });
  });

  it("returns the purchase shape with the REF balance and omits an empty tax id", async () => {
    const result = await listOpenDocuments(query(), STORE_ID, NOW);
    const openPurchase = result.items.find((item) => item.id === "od-purchase-open");
    const saleWithoutTaxId = result.items.find((item) => item.id === "od-sale-mid");

    expect(openPurchase).toEqual({
      contact: { id: "od-supplier", name: "Distribuidora Norte", taxId: "J-22222222-2" },
      createdAt: "2026-06-05T15:00:00.000Z",
      id: "od-purchase-open",
      number: "C-900001",
      paidRef: 5,
      paidVes: 500,
      pendingRef: 15,
      pendingVes: 1500,
      refRateVes: 100,
      status: "recibido",
      totalRef: 20,
      totalVes: 2000,
      type: "purchase",
    });
    expect(saleWithoutTaxId?.contact).toEqual({ id: "od-customer-b", name: "Bodega Sin Rif" });
  });

  it("filters by type", async () => {
    expect(await listIds({ types: ["sale"] })).toEqual(["od-sale-old", "od-sale-mid", "od-sale-new"]);
    expect(await listIds({ types: ["purchase"] })).toEqual([
      "od-purchase-open",
      "od-purchase-ordered",
    ]);
  });

  it("filters by contact", async () => {
    expect(await listIds({ contactId: "od-customer-a" })).toEqual(["od-sale-old", "od-sale-new"]);
    expect(await listIds({ contactId: "od-supplier" })).toEqual([
      "od-purchase-open",
      "od-purchase-ordered",
    ]);
  });

  it("searches by document number, shown purchase number, contact name and tax id", async () => {
    expect(await listIds({ search: "v-900002" })).toEqual(["od-sale-mid"]);
    expect(await listIds({ search: "#C-900001" })).toEqual(["od-purchase-open"]);
    expect(await listIds({ search: "panaderia avila" })).toEqual(["od-sale-old", "od-sale-new"]);
    expect(await listIds({ search: "22222222" })).toEqual([
      "od-purchase-open",
      "od-purchase-ordered",
    ]);
    expect(await listIds({ search: "no-existe" })).toEqual([]);
  });

  it("filters by Caracas date range, inclusive on both ends", async () => {
    expect(await listIds({ from: "2026-06-05", to: "2026-06-10" })).toEqual([
      "od-purchase-open",
      "od-sale-mid",
    ]);
  });

  it("uses the Caracas day, not the UTC day, for the document date", async () => {
    // 2026-06-11 02:00 UTC sigue siendo 10 de junio en Caracas.
    const lateSale = sale({ createdAt: "2026-06-11T02:00:00.000Z", id: "od-sale-late" });
    mockSales.push(lateSale);

    try {
      expect(await listIds({ from: "2026-06-10", to: "2026-06-10" })).toEqual([
        "od-sale-mid",
        "od-sale-late",
      ]);
      expect(await listIds({ from: "2026-06-11", to: "2026-06-11" })).toEqual([]);
    } finally {
      mockSales.splice(mockSales.indexOf(lateSale), 1);
    }
  });

  it("keeps documents that are olderThanDays or more days old", async () => {
    // Hoy 2026-06-20 Caracas: 10 dias atras es el 2026-06-10, que entra.
    expect(await listIds({ olderThanDays: 10 })).toEqual([
      "od-sale-old",
      "od-purchase-open",
      "od-sale-mid",
    ]);
    expect(await listIds({ olderThanDays: 11 })).toEqual(["od-sale-old", "od-purchase-open"]);
    expect(await listIds({ olderThanDays: 30 })).toEqual([]);
  });

  it("combines olderThanDays with to keeping the oldest bound", () => {
    expect(resolveOpenDocumentsDateRange({ olderThanDays: 10, to: "2026-06-03" }, NOW)).toEqual({
      from: undefined,
      to: "2026-06-03",
    });
    expect(
      resolveOpenDocumentsDateRange({ from: "2026-06-01", olderThanDays: 10, to: "2026-06-19" }, NOW),
    ).toEqual({ from: "2026-06-01", to: "2026-06-10" });
    expect(resolveOpenDocumentsDateRange({ to: "2026-06-19" }, NOW)).toEqual({
      from: undefined,
      to: "2026-06-19",
    });
  });

  it("totals the whole filtered set and paginates after it", async () => {
    const result = await listOpenDocuments(query({ limit: 2, skip: 2 }), STORE_ID, NOW);

    expect(result.items.map((item) => item.id)).toEqual(["od-sale-mid", "od-purchase-ordered"]);
    expect(result).toMatchObject({ limit: 2, skip: 2, total: 5 });
    expect(result.totals).toEqual({
      count: 5,
      pendingRef: 61,
      pendingVes: 6100.1,
      truncated: false,
    });
  });

  it("returns an empty list with zero totals when nothing matches", async () => {
    const result = await listOpenDocuments(query(), "store-without-documents", NOW);

    expect(result).toEqual({
      items: [],
      limit: 100,
      skip: 0,
      total: 0,
      totals: { count: 0, pendingVes: 0, truncated: false },
    });
  });

  it("drops a document whose balance rounds to zero and leaves the sale REF balance out without a rate", () => {
    const base = {
      createdAt: "2026-06-01T15:00:00.000Z",
      id: "x",
      number: "V-1",
      refRateVes: 0,
      status: "pendiente_pago" as const,
      totalRef: 10,
      totalVes: 1000,
      type: "sale" as const,
    };

    expect(buildOpenDocument({ ...base, paidVes: 999.996 })).toBeNull();
    expect(buildOpenDocument({ ...base, paidVes: 1200 })).toBeNull();
    expect(buildOpenDocument({ ...base, paidVes: 0 })).not.toHaveProperty("pendingRef");
  });
});
