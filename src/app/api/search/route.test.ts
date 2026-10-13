/**
 * @jest-environment node
 */

jest.mock("../../../modules/search/services/search.mock-server", () => {
  const actual = jest.requireActual("../../../modules/search/services/search.mock-server");

  return { ...actual, searchStore: jest.fn(actual.searchStore) };
});

import { searchStore } from "@/modules/search/services/search.mock-server";
import type { GlobalSearchResults } from "@/modules/search/types";

import { GET } from "./route";

const SUR_STORE_ID = "00000000-0000-4000-8000-000000000002";

const searchStoreMock = searchStore as jest.MockedFunction<typeof searchStore>;

function search(q: string, headers: Record<string, string> = {}) {
  return GET(
    new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`, { headers }),
  );
}

async function searchAs(role: string, q: string) {
  const response = await search(q, { "x-demo-role": role });
  const body = (await response.json()) as { data: GlobalSearchResults };

  expect(response.status).toBe(200);

  return body.data;
}

describe("/api/search", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    searchStoreMock.mockClear();
  });

  it("returns every type to the admin, capped at five per type", async () => {
    const data = await searchAs("admin", "000001");

    expect(data.sales).toEqual([
      expect.objectContaining({
        customerName: "Ferreteria La Central",
        id: "sale-001",
        number: "V-000001",
        totalRef: 15,
      }),
    ]);
    expect(data.purchases).toEqual([
      expect.objectContaining({
        id: "purchase-001",
        number: "C-000001",
        supplierName: "Suministros Industriales CA",
      }),
    ]);
    expect(data.contacts).toEqual([
      { id: "cont-customer", name: "Ferreteria La Central", taxId: "J-00000001-1", type: "cliente" },
    ]);

    const many = await searchAs("admin", "V-");

    expect(many.sales).toHaveLength(5);
  });

  it("finds a product by exact barcode, SKU prefix and name without exposing costs", async () => {
    const byBarcode = await searchAs("admin", "7501234567890");
    const bySku = await searchAs("admin", "HER-");
    const byName = await searchAs("admin", "pintura");

    expect(byBarcode.products).toEqual([
      { barcode: "7501234567890", id: "prod-drill", name: "Taladro percutor", sku: "her-tal-001" },
    ]);
    expect(bySku.products.map((product) => product.id)).toEqual(["prod-hammer", "prod-drill"]);
    expect(byName.products.map((product) => product.id)).toEqual(["prod-paint", "prod-latex"]);
  });

  it("gives the seller products, sales and customer-only contacts, never purchases", async () => {
    const numbers = await searchAs("vendedor", "000001");
    const suppliers = await searchAs("vendedor", "Suministros");
    const both = await searchAs("vendedor", "Doble Via");
    const products = await searchAs("vendedor", "taladro");

    expect(numbers.sales.map((sale) => sale.id)).toEqual(["sale-001"]);
    expect(numbers.purchases).toEqual([]);
    expect(numbers.contacts.map((contact) => contact.id)).toEqual(["cont-customer"]);
    expect(suppliers.contacts).toEqual([]);
    expect(both.contacts).toEqual([]);
    expect(products.products.map((product) => product.id)).toEqual(["prod-drill"]);
  });

  it("gives the warehouse role products and purchases only", async () => {
    const numbers = await searchAs("almacen", "000001");
    const products = await searchAs("almacen", "taladro");

    expect(numbers.purchases.map((purchase) => purchase.id)).toEqual(["purchase-001"]);
    expect(numbers.sales).toEqual([]);
    expect(numbers.contacts).toEqual([]);
    expect(products.products.map((product) => product.id)).toEqual(["prod-drill"]);
  });

  it("gives the accountant sales, purchases and contacts, never products", async () => {
    const numbers = await searchAs("contador", "000001");
    const products = await searchAs("contador", "taladro");
    const suppliers = await searchAs("contador", "Suministros");

    expect(numbers.sales.map((sale) => sale.id)).toEqual(["sale-001"]);
    expect(numbers.purchases.map((purchase) => purchase.id)).toEqual(["purchase-001"]);
    expect(products.products).toEqual([]);
    expect(suppliers.contacts.map((contact) => contact.id)).toEqual(["cont-supplier"]);
  });

  it("honours per-user permission overrides", async () => {
    const response = await search("000001", {
      // Vendedor con `contacts.manage` concedido: sigue sin `purchases.view`.
      "x-demo-user-id": "55555555-5555-4555-8555-555555555555",
    });
    const body = (await response.json()) as { data: GlobalSearchResults };

    expect(response.status).toBe(200);
    expect(body.data.purchases).toEqual([]);
    expect(body.data.sales).toHaveLength(1);
  });

  it("never returns documents, products or contacts of another store", async () => {
    for (const q of ["arroz", "sur-arr-001", "S-000001", "Abasto El Sur", "prod-sur-arroz"]) {
      const data = await searchAs("admin", q);

      expect(data).toEqual({ contacts: [], products: [], purchases: [], sales: [] });
    }

    const response = await search("arroz", {
      "x-demo-role": "admin",
      "x-demo-store-id": SUR_STORE_ID,
    });
    const body = (await response.json()) as { data: GlobalSearchResults };

    expect(body.data.products.map((product) => product.id)).toEqual(["prod-sur-arroz"]);
    expect(searchStoreMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ storeId: SUR_STORE_ID }),
    );
  });

  it("ignores a store id sent by the client in the query string", async () => {
    const response = await GET(
      new Request(`http://localhost/api/search?q=arroz&storeId=${SUR_STORE_ID}&store_id=${SUR_STORE_ID}`),
    );
    const body = (await response.json()) as { data: GlobalSearchResults };

    expect(body.data.products).toEqual([]);
  });

  it.each(["", " ", "a", " a ", "a\u0000", "%%", "__", '"*'])(
    "answers empty groups without calling the service for %p",
    async (q) => {
      const data = await searchAs("admin", q);

      expect(data).toEqual({ contacts: [], products: [], purchases: [], sales: [] });
      expect(searchStoreMock).not.toHaveBeenCalled();
    },
  );

  it("answers empty groups when q is missing", async () => {
    const response = await GET(new Request("http://localhost/api/search"));

    expect(response.status).toBe(200);
    expect(searchStoreMock).not.toHaveBeenCalled();
  });

  it("treats a UUID as text and matches an id of the store", async () => {
    const unknown = await searchAs("admin", "3f2b8c1e-5d47-4a9b-8e21-0c9d7a6b5e4f");
    const byId = await searchAs("admin", "prod-drill");
    const saleById = await searchAs("admin", "sale-001");
    const hiddenToAccountant = await searchAs("contador", "prod-drill");

    expect(unknown).toEqual({ contacts: [], products: [], purchases: [], sales: [] });
    expect(byId.products.map((product) => product.id)).toEqual(["prod-drill"]);
    expect(saleById.sales.map((sale) => sale.id)).toEqual(["sale-001"]);
    expect(hiddenToAccountant.products).toEqual([]);
  });

  it.each(["%,()'\"\\", "<script>alert(1)</script>", "a,id.neq.0)", "name.ilike.*", "ab\u0000cd"])(
    "answers 200 for the hostile term %p",
    async (q) => {
      const response = await search(q);

      expect(response.status).toBe(200);
    },
  );

  it("strips control characters and collapses spaces before searching", async () => {
    await searchAs("admin", "  tala\u0000dro   percutor ");

    expect(searchStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "taladro percutor" }),
    );
  });

  it("rejects a term longer than 80 characters with 400", async () => {
    const atLimit = await search("a".repeat(80));
    const tooLong = await search("a".repeat(81));
    const body = await tooLong.json();

    expect(atLimit.status).toBe(200);
    expect(tooLong.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(searchStoreMock).toHaveBeenCalledTimes(1);
  });

  it("answers 401 without a session", async () => {
    process.env.ALLOW_DEMO_AUTH = "false";

    try {
      const response = await search("taladro");

      expect(response.status).toBe(401);
      expect(searchStoreMock).not.toHaveBeenCalled();
    } finally {
      process.env.ALLOW_DEMO_AUTH = "true";
    }
  });

  it("answers 403 to the superadmin, who has no store", async () => {
    const response = await search("taladro", { "x-demo-role": "superadmin" });

    expect(response.status).toBe(403);
    expect(searchStoreMock).not.toHaveBeenCalled();
  });
});
