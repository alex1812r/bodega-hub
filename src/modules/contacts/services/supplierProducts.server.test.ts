/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { createSupplierProduct } from "./supplierProducts.server";

describe("supplierProducts.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates supplier type before creating a relation", async () => {
    const rpc = jest.fn().mockResolvedValue({
      error: { message: "Tipo de contacto invalido para esta operacion" },
    });
    const supabase = {
      from: jest.fn(),
      rpc,
    };
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    await expect(
      createSupplierProduct({
        productId: "22222222-2222-4222-8222-222222222222",
        supplierId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });

    expect(rpc).toHaveBeenCalledWith("assert_contact_type", {
      p_contact_id: "33333333-3333-4333-8333-333333333333",
      p_expected_types: ["proveedor", "ambos"],
    });
  });
});
