/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { ApiError } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createSupplierProduct } from "./supplierProducts.server";

type QueryResult = {
  count?: number | null;
  data?: unknown;
  error?: unknown;
};

function createMockSupabase(handlers: {
  from?: jest.Mock;
  rpc?: jest.Mock;
}) {
  return {
    from: handlers.from ?? jest.fn(),
    rpc: handlers.rpc ?? jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function createChain(result: QueryResult) {
  const terminal = {
    maybeSingle: jest.fn().mockResolvedValue(result),
    range: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
  };

  const chain: Record<string, jest.Mock> = {
    delete: jest.fn(),
    eq: jest.fn(),
    in: jest.fn(),
    insert: jest.fn(),
    order: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    ...terminal,
  };

  chain.delete.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.order.mockReturnValue(terminal);

  return chain;
}

const supplierId = "33333333-3333-4333-8333-333333333333";
const productId = "22222222-2222-4222-8222-222222222222";
const supplierProductId = "44444444-4444-4444-8444-444444444444";

describe("supplierProducts.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates supplier type before creating a relation", async () => {
    const rpc = jest.fn().mockResolvedValue({
      error: { message: "Tipo de contacto invalido para esta operacion" },
    });
    const supabase = createMockSupabase({ rpc });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    await expect(
      createSupplierProduct(
        {
          productId,
          supplierId,
          supplierSku: undefined,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });

    expect(rpc).toHaveBeenCalledWith("assert_contact_type", {
      p_contact_id: supplierId,
      p_expected_types: ["proveedor", "ambos"],
    });
  });

  it("reactivates an inactive supplier-product link on create", async () => {
    const existingChain = createChain({
      data: { id: supplierProductId, is_active: false },
      error: null,
    });
    const reactivateChain = createChain({
      data: {
        id: supplierProductId,
        is_active: true,
        last_cost_ref: 0,
        product_id: productId,
        supplier_id: supplierId,
      },
      error: null,
    });
    const productsChain = createChain({
      data: { id: productId },
      error: null,
    });
    const historyChain = createChain({ data: [], error: null });
    const packUnitsChain = createChain({ data: [], error: null });
    packUnitsChain.order.mockReturnValue(packUnitsChain);
    const detailChain = createChain({
      data: {
        id: supplierProductId,
        is_active: true,
        last_cost_ref: 4.5,
        product_id: productId,
        supplier_id: supplierId,
      },
      error: null,
    });

    const from = jest
      .fn()
      .mockReturnValueOnce(productsChain)
      .mockReturnValueOnce(existingChain)
      .mockReturnValueOnce(reactivateChain)
      .mockReturnValueOnce(detailChain)
      .mockReturnValueOnce(historyChain)
      .mockReturnValueOnce(packUnitsChain);

    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          history_id: "history-1",
          supplier_product: {
            id: supplierProductId,
            is_active: true,
            last_cost_ref: 4.5,
            product_id: productId,
            supplier_id: supplierId,
          },
          variation_percent: null,
        },
        error: null,
      });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(createMockSupabase({ from, rpc }));

    const result = await createSupplierProduct(
      {
        lastCostRef: 4.5,
        productId,
        supplierId,
        supplierSku: "SUP-RELINK",
      },
      DEFAULT_STORE_ID,
    );

    expect(result.id).toBe(supplierProductId);
    expect(result.isActive).toBe(true);
    expect(result.lastCostRef).toBe(4.5);
    expect(reactivateChain.update).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "register_supplier_product_price",
      expect.objectContaining({
        p_origin: "vinculacion",
        p_new_cost_ref: 4.5,
        p_supplier_product_id: supplierProductId,
      }),
    );
  });

  it("rolls back a newly inserted supplier-product row when initial price registration fails", async () => {
    const existingChain = createChain({ data: null, error: null });
    const productsChain = createChain({
      data: { id: productId },
      error: null,
    });
    const insertChain = createChain({
      data: {
        id: supplierProductId,
        is_active: true,
        last_cost_ref: 0,
        product_id: productId,
        supplier_id: supplierId,
      },
      error: null,
    });
    const deleteChain = createChain({ data: null, error: null });

    const from = jest
      .fn()
      .mockReturnValueOnce(productsChain)
      .mockReturnValueOnce(existingChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(deleteChain);

    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "Price RPC failed"));

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(createMockSupabase({ from, rpc }));

    await expect(
      createSupplierProduct(
        {
          lastCostRef: 3,
          productId,
          supplierId,
          supplierSku: undefined,
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 500,
    });

    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", supplierProductId);
  });
});
