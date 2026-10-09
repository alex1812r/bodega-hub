/**
 * @jest-environment node
 */
/**
 * COM-14 · la preferencia «Desarmar siempre al recibir compras» de la receta se
 * guarda con el producto (`PATCH /api/products/{id}`, `packConversion`) y la lee
 * `GET /api/inventory/pack-conversions`, que es la consulta de `/purchases/create`.
 */

import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET as getProduct, PATCH } from "../../products/[id]/route";
import { GET } from "./route";

function patch(id: string, packConversion: unknown, role = "admin") {
  return PATCH(
    new Request(`http://localhost/api/products/${id}`, {
      body: JSON.stringify({ packConversion }),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "PATCH",
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function listedRecipe(packProductId: string) {
  const response = await GET(
    new Request("http://localhost/api/inventory/pack-conversions", {
      headers: { "x-demo-role": "almacen" },
    }),
  );
  const { data } = (await response.json()) as {
    data: { alwaysDisassembleOnReceive?: boolean; packProduct: { id: string } }[];
  };

  return data.find((item) => item.packProduct.id === packProductId);
}

function link(extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mode: "link_existing",
    unitProductId: "rd-lata",
    unitsPerPack: 12,
    ...extra,
  };
}

describe("receta de empaque · alwaysDisassembleOnReceive por las rutas", () => {
  beforeAll(() => {
    for (const [id, name] of [
      ["rd-caja", "Caja de latas"],
      ["rd-lata", "Lata suelta"],
    ]) {
      mockProducts.push({
        categoryId: "cat-tools",
        currentCostRef: 1,
        currentStock: 2,
        id,
        isActive: true,
        minStock: 0,
        name,
        salePriceRef: 2,
        sku: id,
        storeId: DEFAULT_STORE_ID,
      });
    }
  });

  it("sin la preferencia la receta no trae la clave", async () => {
    const response = await patch("rd-caja", link());

    expect(response.status).toBe(200);
    expect(await listedRecipe("rd-caja")).not.toHaveProperty("alwaysDisassembleOnReceive");
  });

  it("PATCH con alwaysDisassembleOnReceive: true la guarda; la devuelven el producto y el listado de recetas", async () => {
    const response = await patch("rd-caja", link({ alwaysDisassembleOnReceive: true }));
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.packConversion).toMatchObject({ alwaysDisassembleOnReceive: true, role: "pack" });
    expect(await listedRecipe("rd-caja")).toMatchObject({ alwaysDisassembleOnReceive: true });

    const detail = await getProduct(new Request("http://localhost/api/products/rd-caja"), {
      params: Promise.resolve({ id: "rd-caja" }),
    });

    expect((await detail.json()).data.packConversion).toMatchObject({
      alwaysDisassembleOnReceive: true,
    });
  });

  it("PATCH sin la clave no la cambia; con false la quita", async () => {
    await patch("rd-caja", link({ unitsPerPack: 24 }));

    expect(await listedRecipe("rd-caja")).toMatchObject({
      alwaysDisassembleOnReceive: true,
      unitsPerPack: 24,
    });

    await patch("rd-caja", link({ alwaysDisassembleOnReceive: false, unitsPerPack: 24 }));

    expect(await listedRecipe("rd-caja")).not.toHaveProperty("alwaysDisassembleOnReceive");
  });

  it("un valor que no es booleano: 400 con el aviso en español y la receta intacta", async () => {
    const response = await patch("rd-caja", link({ alwaysDisassembleOnReceive: "si" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect((body.error.issues as { message: string }[]).map((issue) => issue.message)).toEqual([
      "Indica si el empaque se desarma siempre al recibir compras.",
    ]);
    expect(await listedRecipe("rd-caja")).toMatchObject({ unitsPerPack: 24 });
  });
});
