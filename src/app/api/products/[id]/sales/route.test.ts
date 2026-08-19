/**
 * @jest-environment node
 */

jest.mock("../../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

jest.mock("../../../../../lib/api/assertStoreResource", () => ({
  ...jest.requireActual("../../../../../lib/api/assertStoreResource"),
  assertSupabaseStoreResource: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

function createSaleItemsQuery(result: { data: unknown; error: null }) {
  const query = {
    eq: jest.fn(),
    select: jest.fn(),
    then: (onFulfilled: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(onFulfilled),
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("/api/products/[id]/sales", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns product sales history", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-paint/sales"),
      context("prod-paint"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ saleId: "sale-002", status: "pendiente_pago" }),
        expect.objectContaining({ saleId: "sale-004", status: "cancelada" }),
      ]),
    );
    expect(body.data.totals).toEqual({
      totalRef: 20,
      totalVes: 10200,
      units: 1,
    });
  });

  it("returns 404 when the product is not in the store", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-missing/sales"),
      context("prod-missing"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("returns paginated sales from sale_items joined with sales", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() =>
          createSaleItemsQuery({
            data: [
              {
                id: "item-1",
                product_id: "prod-1",
                quantity: 1,
                sale_id: "sale-1",
                sales: {
                  created_at: "2026-05-18T15:10:00.000Z",
                  invoice_number: "V-000002",
                  status: "pagada",
                  store_id: "store-1",
                },
                subtotal_ref: 20,
                subtotal_ves: 10200,
                unit_price_ref: 20,
              },
              {
                id: "item-2",
                product_id: "prod-1",
                quantity: 2,
                sale_id: "sale-2",
                sales: {
                  created_at: "2026-05-16T11:45:00.000Z",
                  invoice_number: "V-000004",
                  status: "cancelada",
                  store_id: "store-1",
                },
                subtotal_ref: 40,
                subtotal_ves: 20080,
                unit_price_ref: 20,
              },
            ],
            error: null,
          }),
        ),
      });

      const response = await GET(
        new Request("http://localhost/api/products/prod-1/sales?skip=1"),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({
          invoiceNumber: "V-000004",
          saleId: "sale-2",
          status: "cancelada",
        }),
      ]);
      expect(body.data.total).toBe(2);
      expect(body.data.totals).toEqual({
        totalRef: 20,
        totalVes: 10200,
        units: 1,
      });
    });
  });
});
