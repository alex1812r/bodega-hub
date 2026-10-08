/**
 * @jest-environment node
 *
 * PRO-F4 · el motivo de un cambio de precio llega a la RPC `update_product_price`
 * (`p_reason`) y vuelve en el historial.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/api/assertStoreResource", () => ({
  ...jest.requireActual("../../../lib/api/assertStoreResource"),
  assertSupabaseStoreResource: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getProductPriceHistory, updateProductPrice } from "./products.server";

const productRow = {
  category_id: "cat-1",
  current_cost_ref: 10,
  current_stock: 5,
  id: "prod-1",
  is_active: true,
  min_stock: 2,
  name: "Taladro",
  sale_price_ref: 13,
  sku: "sku-001",
};

function historyRow(reason: string | null) {
  return {
    changed_by: "user-1",
    created_at: "2026-05-20T10:00:00.000Z",
    id: "price-1",
    new_sale_price_ref: 13,
    old_sale_price_ref: 12,
    product_id: "prod-1",
    reason,
  };
}

function mockSupabase(reason: string | null) {
  const rpc = jest.fn().mockResolvedValue({ data: productRow, error: null });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: jest.fn((table: string) => {
      const isHistory = table === "product_price_history";
      const chain: Record<string, jest.Mock> = {
        eq: jest.fn(),
        limit: jest.fn(),
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: isHistory ? historyRow(reason) : productRow, error: null }),
        or: jest.fn(),
        order: jest.fn(),
        range: jest.fn().mockResolvedValue({ count: 1, data: [historyRow(reason)], error: null }),
        select: jest.fn(),
      };

      chain.limit.mockReturnValue(chain);
      chain.or.mockReturnValue(chain);
      chain.order.mockReturnValue(chain);
      chain.select.mockReturnValue(chain);
      // `products` con `head: true` se espera tras el último `eq`.
      chain.eq.mockReturnValue(
        isHistory ? chain : Object.assign(Promise.resolve({ count: 1, error: null }), chain),
      );

      return chain;
    }),
    rpc,
  });

  return rpc;
}

describe("products.server updateProductPrice · reason (PRO-F4)", () => {
  it("passes the reason to the RPC as p_reason and returns it in the history entry", async () => {
    const rpc = mockSupabase("Edición del producto");

    const result = await updateProductPrice(
      "prod-1",
      { reason: "Edición del producto", salePriceRef: 13 },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledWith("update_product_price", {
      p_new_sale_price_ref: 13,
      p_product_id: "prod-1",
      p_reason: "Edición del producto",
    });
    expect(result.history).toMatchObject({ reason: "Edición del producto", salePriceRef: 13 });
  });

  it.each([[undefined], [null]])("sends p_reason null when the reason is %p", async (reason) => {
    const rpc = mockSupabase(null);

    const result = await updateProductPrice("prod-1", { reason, salePriceRef: 13 }, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("update_product_price", {
      p_new_sale_price_ref: 13,
      p_product_id: "prod-1",
      p_reason: null,
    });
    expect(result.history.reason).toBeNull();
  });
});

describe("products.server getProductPriceHistory · reason (PRO-F4)", () => {
  it("returns the stored reason of each change", async () => {
    mockSupabase("Ajuste de margen a 30 %");

    const history = await getProductPriceHistory("prod-1", new URLSearchParams(), DEFAULT_STORE_ID);

    expect(history.items).toEqual([
      expect.objectContaining({ id: "price-1", reason: "Ajuste de margen a 30 %" }),
    ]);
  });
});
