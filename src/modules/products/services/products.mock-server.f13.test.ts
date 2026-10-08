/**
 * @jest-environment node
 *
 * PRO-F13 · paridad del mock con `products.server`: la descripción del producto
 * se guarda en el alta, cambia o se borra en la edición y vuelve en la respuesta.
 */
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createProduct, getProductById, updateProduct } from "./products.mock-server";

const product = (sku: string, extra: Parameters<typeof createProduct>[0] = {}) =>
  createProduct(
    { categoryId: "cat-tools", name: `F13 ${sku}`, salePriceRef: 10, sku, ...extra },
    DEFAULT_STORE_ID,
  );

describe("products.mock-server · descripción (PRO-F13)", () => {
  it("el alta guarda la descripción y sin ella queda `null`", () => {
    expect(product("f13-mock-a", { description: "Harina fina" }).description).toBe("Harina fina");
    expect(product("f13-mock-b").description).toBeNull();
  });

  it("la edición la cambia, la borra con `null` y la conserva si no viaja", () => {
    const created = product("f13-mock-c", { description: "Antes" });

    expect(updateProduct(created.id, { description: "Después" }, DEFAULT_STORE_ID).description).toBe(
      "Después",
    );
    expect(updateProduct(created.id, { minStock: 3 }, DEFAULT_STORE_ID).description).toBe("Después");
    expect(updateProduct(created.id, { description: null }, DEFAULT_STORE_ID).description).toBeNull();
    expect(getProductById(created.id, DEFAULT_STORE_ID).description).toBeNull();
  });

  it("la misma clave de idempotencia con otra descripción es un 409; con la misma, el mismo producto", () => {
    const clientRequestId = "f13f13f1-3f13-4f13-8f13-f13f13f13f13";
    const first = product("f13-mock-d", { clientRequestId, description: "Una" });

    expect(product("f13-mock-d", { clientRequestId, description: "Una" }).id).toBe(first.id);
    expect(() => product("f13-mock-d", { clientRequestId, description: "Otra" })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });
});
