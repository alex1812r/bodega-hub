/**
 * @jest-environment node
 *
 * PRO-F11 · filtros del listado en el servicio real:
 * - un `categoryId`, `sku` o `barcode` de miles de caracteres viajaba entero a
 *   PostgREST ("URI too long") y salía como 500: ahora es un 400 sin consulta;
 * - un término de búsqueda hecho solo de comodines devolvía toda la tienda.
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listProducts } from "./products.server";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

function installList() {
  const chain: Record<string, jest.Mock> = {
    eq: jest.fn(),
    is: jest.fn(),
    or: jest.fn(),
    order: jest.fn(),
    range: jest.fn().mockResolvedValue({ count: 3, data: [], error: null }),
    select: jest.fn(),
  };

  for (const method of ["eq", "is", "or", "order", "select"]) {
    chain[method].mockReturnValue(chain);
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(() => chain) });

  return chain;
}

describe("products.server listProducts · filtros desmedidos (PRO-F11)", () => {
  it.each(["categoryId", "sku", "barcode"])(
    "un %s de 10 000 caracteres responde 400 y no consulta",
    async (name) => {
      const chain = installList();

      await expect(
        listProducts(new URLSearchParams({ [name]: "a".repeat(10_000) }), DEFAULT_STORE_ID),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

      expect(chain.range).not.toHaveBeenCalled();
    },
  );

  it("un categoryId con un NUL responde 400", async () => {
    installList();

    await expect(
      listProducts(new URLSearchParams({ categoryId: `${CATEGORY_ID}\u0000` }), DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("un categoryId normal sigue filtrando", async () => {
    const chain = installList();

    await listProducts(new URLSearchParams({ categoryId: CATEGORY_ID }), DEFAULT_STORE_ID);

    expect(chain.eq).toHaveBeenCalledWith("category_id", CATEGORY_ID);
  });
});

describe("products.server listProducts · búsqueda de solo comodines (PRO-F11)", () => {
  it.each(['"', "%", "_", "*", "\\", '%_*"', "\u0000\u0000"])(
    "el término [%s] devuelve la lista vacía, no la tienda entera",
    async (search) => {
      const chain = installList();

      const list = await listProducts(
        new URLSearchParams({ limit: "25", search }),
        DEFAULT_STORE_ID,
      );

      expect(list).toEqual({ items: [], limit: 25, skip: 0, total: 0 });
      expect(chain.or).not.toHaveBeenCalled();
      expect(chain.range).not.toHaveBeenCalled();
    },
  );

  it.each(["", "   "])("sin término ([%s]) no filtra", async (search) => {
    const chain = installList();

    const list = await listProducts(new URLSearchParams({ search }), DEFAULT_STORE_ID);

    expect(list.total).toBe(3);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it("un término con texto y un comodín sigue buscando", async () => {
    const chain = installList();

    await listProducts(new URLSearchParams({ search: "100%" }), DEFAULT_STORE_ID);

    expect(chain.or).toHaveBeenCalledTimes(1);
  });

  it("el filtro exacto por código de barras manda sobre un término de solo comodines", async () => {
    const chain = installList();

    await listProducts(new URLSearchParams({ barcode: "750100", search: "%" }), DEFAULT_STORE_ID);

    expect(chain.eq).toHaveBeenCalledWith("barcode", "750100");
    expect(chain.range).toHaveBeenCalled();
  });
});
