/**
 * @jest-environment node
 */

jest.mock("../supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";

import { assertSupabaseStoreResource } from "./assertStoreResource";

const UUID = "950df0d2-f0c3-4cee-b935-86d0c8fd47bb";

function mountAdmin(row: { store_id: string } | null) {
  const eq = jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }) }));
  const from = jest.fn(() => ({ select: jest.fn(() => ({ eq })) }));

  (createAdminSupabaseClient as jest.Mock).mockReturnValue({ from });

  return { eq, from };
}

describe("assertSupabaseStoreResource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deja pasar el recurso de la tienda y consulta por el id recibido", async () => {
    const { eq } = mountAdmin({ store_id: "store-a" });

    await expect(
      assertSupabaseStoreResource("products", UUID, "store-a", "Producto no encontrado."),
    ).resolves.toBeUndefined();
    expect(eq).toHaveBeenCalledWith("id", UUID);
  });

  it("404 si no existe y 403 si es de otra tienda", async () => {
    mountAdmin(null);
    await expect(
      assertSupabaseStoreResource("products", UUID, "store-a", "Producto no encontrado."),
    ).rejects.toMatchObject({ message: "Producto no encontrado.", status: 404 });

    mountAdmin({ store_id: "store-b" });
    await expect(
      assertSupabaseStoreResource("products", UUID, "store-a", "Producto no encontrado."),
    ).rejects.toMatchObject({ status: 403 });
  });

  // INV-L4: con un NUL detrás de un uuid válido la consulta encontraba el producto
  // y daba por buena la pertenencia de un id que luego viajaba entero a la RPC.
  it.each([
    ["al final de un uuid válido", `${UUID}\u0000`],
    ["en medio", `${UUID}\u0000otro`],
  ])("400 sin consultar la base si el id trae NUL %s", async (_name, id) => {
    const { from } = mountAdmin({ store_id: "store-a" });

    await expect(
      assertSupabaseStoreResource("products", id, "store-a", "Producto no encontrado."),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Los datos enviados no son validos.",
      status: 400,
    });
    expect(from).not.toHaveBeenCalled();
  });
});
