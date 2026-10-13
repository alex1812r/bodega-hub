/**
 * @jest-environment node
 *
 * PRO-F11 · filtros de `/api/categories` y de la cola "Por revisar" en los
 * servicios reales: nada de miles de caracteres hacia PostgREST.
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listCategories } from "./categories.server";
import { listPriceReview } from "./priceReview.server";

function installList() {
  const chain: Record<string, jest.Mock> = {
    eq: jest.fn(),
    ilike: jest.fn(),
    order: jest.fn(),
    range: jest.fn().mockResolvedValue({ count: 4, data: [], error: null }),
    select: jest.fn(),
  };

  for (const method of ["eq", "ilike", "order", "select"]) {
    chain[method].mockReturnValue(chain);
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => chain) });

  return chain;
}

describe("categories.server listCategories · búsqueda (PRO-F11)", () => {
  it("recorta el término a 100 caracteres y le quita los caracteres de control", async () => {
    const chain = installList();

    await listCategories(
      new URLSearchParams({ search: `\u0000${"a".repeat(10_000)}` }),
      DEFAULT_STORE_ID,
    );

    expect(chain.ilike).toHaveBeenCalledWith("name", `%${"a".repeat(100)}%`);
  });

  it("un comodín dentro del término no se interpreta", async () => {
    const chain = installList();

    await listCategories(new URLSearchParams({ search: "50%" }), DEFAULT_STORE_ID);

    expect(chain.ilike).toHaveBeenCalledWith("name", "%50_%");
  });

  it("un término de solo comodines devuelve la lista vacía sin consultar", async () => {
    const chain = installList();

    const list = await listCategories(new URLSearchParams({ search: "%" }), DEFAULT_STORE_ID);

    expect(list).toMatchObject({ items: [], total: 0 });
    expect(chain.range).not.toHaveBeenCalled();
  });
});

describe("priceReview.server listPriceReview · purchaseId (PRO-F11)", () => {
  it("un purchaseId de 10 000 caracteres responde 400 y no consulta", async () => {
    const chain = installList();

    await expect(
      listPriceReview(new URLSearchParams({ purchaseId: "a".repeat(10_000) }), DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    expect(chain.range).not.toHaveBeenCalled();
  });
});
