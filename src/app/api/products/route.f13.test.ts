/**
 * @jest-environment node
 *
 * PRO-F13 · `POST /api/products` y `PATCH /api/products/[id]` guardan y
 * devuelven la descripción del producto.
 */
import { PATCH as patchProduct } from "./[id]/route";
import { POST as postProduct } from "./route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function json(url: string, method: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

describe("rutas de producto · descripción (PRO-F13)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("el alta la guarda saneada y la edición la cambia y la borra", async () => {
    const created = await postProduct(
      json("/api/products", "POST", {
        categoryId: "cat-tools",
        description: "  Harina\u0000 fina  ",
        name: "F13 ruta",
        salePriceRef: 5,
        sku: "f13-ruta",
      }),
    );
    const product = (await created.json()).data;

    expect(created.status).toBe(201);
    expect(product.description).toBe("Harina fina");

    const changed = await patchProduct(
      json(`/api/products/${product.id}`, "PATCH", { description: "Otra" }),
      context(product.id),
    );

    expect(changed.status).toBe(200);
    expect((await changed.json()).data.description).toBe("Otra");

    const cleared = await patchProduct(
      json(`/api/products/${product.id}`, "PATCH", { description: "" }),
      context(product.id),
    );

    expect((await cleared.json()).data.description).toBeNull();
  });

  it("más de 500 caracteres responde 400 y no crea el producto", async () => {
    const response = await postProduct(
      json("/api/products", "POST", {
        categoryId: "cat-tools",
        description: "a".repeat(501),
        name: "F13 ruta larga",
        salePriceRef: 5,
        sku: "f13-ruta-larga",
      }),
    );

    expect(response.status).toBe(400);
  });
});
