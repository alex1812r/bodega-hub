/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

jest.mock("../../../../lib/api/assertStoreResource", () => ({
  ...jest.requireActual("../../../../lib/api/assertStoreResource"),
  assertSupabaseStoreResource: jest.fn(),
}));

// El proveedor habitual sale de una consulta aparte (probada en
// supplierProducts.server.preferred.test.ts): aquí solo importa cómo la usa la ruta.
jest.mock("../../../../modules/contacts/services/supplierProducts.server", () => ({
  ...jest.requireActual("../../../../modules/contacts/services/supplierProducts.server"),
  listPreferredSuppliersByProduct: jest.fn(async () => new Map()),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { listPreferredSuppliersByProduct } from "@/modules/contacts/services/supplierProducts.server";

import { DELETE, GET, PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

const productRow = {
  category: { id: "cat-1", is_active: true, name: "Tools" },
  category_id: "cat-1",
  current_cost_ref: 10,
  current_stock: 5,
  id: "prod-1",
  is_active: true,
  min_stock: 2,
  name: "Taladro",
  sale_price_ref: 15,
  sku: "sku-001",
};

function createSupabaseTableChain(
  result: { data: unknown; error: null },
  update?: jest.Mock,
) {
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn(() => chain);
  chain.or = jest.fn(() => chain);
  chain.select = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.update = update ?? jest.fn(() => chain);
  if (update) {
    update.mockReturnValue(chain);
  }
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  return chain;
}

describe("/api/products/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns a product by id", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-drill"),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("prod-drill");
  });

  it("returns not found for unknown product", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/missing"),
      context("missing"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("updates a product with warehouse role", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/products/prod-drill", {
        body: JSON.stringify({ salePriceRef: 16 }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "PATCH",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.salePriceRef).toBe(16);
  });

  it("deactivates a product via PATCH isActive false", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/products/prod-cable", {
        body: JSON.stringify({ isActive: false }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "PATCH",
      }),
      context("prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isActive).toBe(false);

    const getResponse = await GET(
      new Request("http://localhost/api/products/prod-cable"),
      context("prod-cable"),
    );
    const getBody = await getResponse.json();

    expect(getBody.data.isActive).toBe(false);
  });

  it("deletes a product in mock mode", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/products/prod-drill", {
        headers: { "x-demo-role": "almacen" },
        method: "DELETE",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("returns a product from supabase", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => createSupabaseTableChain({ data: productRow, error: null })),
      });

      const response = await GET(
        new Request("http://localhost/api/products/prod-1"),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          id: "prod-1",
          salePriceRef: 15,
          sku: "sku-001",
        }),
      );
    });

    it("adds preferredSupplier to the detail, and not for vendedor", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => createSupabaseTableChain({ data: productRow, error: null })),
      });
      (listPreferredSuppliersByProduct as jest.Mock).mockResolvedValue(
        new Map([["prod-1", { id: "sup-1", name: "Proveedor Uno" }]]),
      );

      const admin = await GET(new Request("http://localhost/api/products/prod-1"), context("prod-1"));
      const vendedor = await GET(
        new Request("http://localhost/api/products/prod-1", { headers: { "x-demo-role": "vendedor" } }),
        context("prod-1"),
      );
      const calls = (listPreferredSuppliersByProduct as jest.Mock).mock.calls;
      (listPreferredSuppliersByProduct as jest.Mock).mockResolvedValue(new Map());

      expect((await admin.json()).data.preferredSupplier).toEqual({ id: "sup-1", name: "Proveedor Uno" });
      expect("preferredSupplier" in (await vendedor.json()).data).toBe(false);
      expect(calls).toEqual([[["prod-1"], "00000000-0000-4000-8000-000000000001"]]);
    });

    it("persists isActive on PATCH", async () => {
      const update = jest.fn();
      const chain = createSupabaseTableChain(
        {
          data: { ...productRow, is_active: false },
          error: null,
        },
        update,
      );

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => chain),
      });

      const response = await PATCH(
        new Request("http://localhost/api/products/prod-1", {
          body: JSON.stringify({ isActive: false }),
          headers: {
            "content-type": "application/json",
            "x-demo-role": "almacen",
          },
          method: "PATCH",
        }),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.isActive).toBe(false);
      expect(update).toHaveBeenCalledWith({ is_active: false });
    });
  });
});
