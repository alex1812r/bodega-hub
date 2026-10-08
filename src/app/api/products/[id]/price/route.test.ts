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

import { GET } from "../route";
import { POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/products/[id]/price", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("updates product price and returns history entry", async () => {
    const response = await POST(
      new Request("http://localhost/api/products/prod-drill/price", {
        body: JSON.stringify({ salePriceRef: 17 }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.product.salePriceRef).toBe(17);
    expect(body.data.history.productId).toBe("prod-drill");
  });

  it("persists the new price in mock mode: a later GET returns it (PRO-F2)", async () => {
    const headers = { "content-type": "application/json", "x-demo-role": "almacen" };

    await POST(
      new Request("http://localhost/api/products/prod-cable/price", {
        body: JSON.stringify({ salePriceRef: 4.2 }),
        headers,
        method: "POST",
      }),
      context("prod-cable"),
    );

    const response = await GET(
      new Request("http://localhost/api/products/prod-cable", { headers }),
      context("prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.salePriceRef).toBe(4.2);
  });

  describe("reason (PRO-F4)", () => {
    function postPrice(body: Record<string, unknown>) {
      return POST(
        new Request("http://localhost/api/products/prod-hammer/price", {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-demo-role": "almacen" },
          method: "POST",
        }),
        context("prod-hammer"),
      );
    }

    it("stores the trimmed reason in the history entry", async () => {
      const response = await postPrice({ reason: "  Ajuste de margen a 30 %  ", salePriceRef: 7.5 });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.history.reason).toBe("Ajuste de margen a 30 %");
    });

    it.each([[{}], [{ reason: "   " }], [{ reason: null }]])(
      "stores no reason when the body adds %j",
      async (extra) => {
        const response = await postPrice({ ...extra, salePriceRef: 7.75 });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.product.salePriceRef).toBe(7.75);
        expect(body.data.history.reason).toBeNull();
      },
    );

    it("accepts a reason of exactly 200 characters and rejects a longer one with 400", async () => {
      const atLimit = await postPrice({ reason: "a".repeat(200), salePriceRef: 8 });

      expect(atLimit.status).toBe(200);

      const tooLong = await postPrice({ reason: "a".repeat(201), salePriceRef: 9 });
      const body = await tooLong.json();

      expect(tooLong.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
    });

    it("rejects a reason that is not text with 400", async () => {
      const response = await postPrice({ reason: 5, salePriceRef: 9 });

      expect(response.status).toBe(400);
    });
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("updates product price via RPC", async () => {
      const historyMaybeSingle = jest.fn().mockResolvedValue({
        data: {
          changed_by: "user-1",
          created_at: "2026-05-20T10:00:00.000Z",
          id: "price-1",
          new_sale_price_ref: 17,
          product_id: "prod-1",
          reason: "Ajuste de margen a 70 %",
        },
        error: null,
      });
      const productMaybeSingle = jest.fn().mockResolvedValue({
        data: {
          category_id: "cat-1",
          current_cost_ref: 10,
          current_stock: 5,
          id: "prod-1",
          is_active: true,
          min_stock: 2,
          name: "Taladro",
          sale_price_ref: 17,
          sku: "SKU-001",
        },
        error: null,
      });

      const rpc = jest.fn().mockResolvedValue({
        data: {
          category_id: "cat-1",
          current_cost_ref: 10,
          current_stock: 5,
          id: "prod-1",
          is_active: true,
          min_stock: 2,
          name: "Taladro",
          sale_price_ref: 17,
          sku: "SKU-001",
        },
        error: null,
      });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn((table: string) => {
          if (table === "product_price_history") {
            return {
              select: jest.fn(() => ({
                eq: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                maybeSingle: historyMaybeSingle,
                order: jest.fn().mockReturnThis(),
              })),
            };
          }

          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockReturnThis(),
              maybeSingle: productMaybeSingle,
              or: jest.fn().mockReturnThis(),
            })),
          };
        }),
        rpc,
      });

      const response = await POST(
        new Request("http://localhost/api/products/prod-1/price", {
          body: JSON.stringify({ reason: " Ajuste de margen a 70 % ", salePriceRef: 17 }),
          headers: {
            "content-type": "application/json",
            "x-demo-role": "almacen",
          },
          method: "POST",
        }),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.product.salePriceRef).toBe(17);
      expect(body.data.history.salePriceRef).toBe(17);
      expect(body.data.history.reason).toBe("Ajuste de margen a 70 %");
      expect(rpc).toHaveBeenCalledWith("update_product_price", {
        p_new_sale_price_ref: 17,
        p_product_id: "prod-1",
        p_reason: "Ajuste de margen a 70 %",
      });
    });

    it("sends no reason to the RPC when the body has none", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: null });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

      const response = await POST(
        new Request("http://localhost/api/products/prod-1/price", {
          body: JSON.stringify({ salePriceRef: 17 }),
          headers: { "content-type": "application/json", "x-demo-role": "almacen" },
          method: "POST",
        }),
        context("prod-1"),
      );

      // Sin fila devuelta la ruta responde 404; aquí solo importa lo que llegó a la RPC.
      expect(response.status).toBe(404);
      expect(rpc).toHaveBeenCalledWith("update_product_price", {
        p_new_sale_price_ref: 17,
        p_product_id: "prod-1",
        p_reason: null,
      });
    });
  });
});
