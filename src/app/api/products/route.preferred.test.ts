/**
 * @jest-environment node
 */

import { saveProductSuppliers } from "@/modules/contacts/services/supplierProducts.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET as getProduct } from "./[id]/route";
import { GET as listProducts } from "./route";

type ListedProduct = { id: string; preferredSupplier?: { id: string; name: string } };

async function list(headers: Record<string, string> = {}) {
  const response = await listProducts(new Request("http://localhost/api/products?limit=100", { headers }));
  const body = await response.json();

  return new Map((body.data.items as ListedProduct[]).map((product) => [product.id, product.preferredSupplier]));
}

async function detail(id: string, headers: Record<string, string> = {}) {
  const response = await getProduct(new Request(`http://localhost/api/products/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });

  return (await response.json()).data as ListedProduct;
}

describe("preferredSupplier en GET /api/products y GET /api/products/[id]", () => {
  it("el listado trae el proveedor habitual de cada producto que lo tiene y nada en los demás", async () => {
    const products = await list();

    expect({
      cable: products.get("prod-cable"),
      hammer: products.get("prod-hammer"),
      // Su único vínculo está inactivo.
      pipe: products.get("prod-pipe"),
      // Sin vínculos.
      paint: products.get("prod-paint"),
    }).toEqual({
      cable: { id: "cont-supplier", name: "Suministros Industriales CA" },
      hammer: { id: "cont-supplier-tools", name: "Herramientas del Lago" },
      paint: undefined,
      pipe: undefined,
    });
  });

  it("el detalle trae el mismo proveedor habitual y lo sigue cuando cambia", async () => {
    const before = await detail("prod-drill");

    saveProductSuppliers(
      "prod-drill",
      [
        { isPreferred: false, supplierId: "cont-both" },
        { isPreferred: true, supplierId: "cont-supplier" },
      ],
      DEFAULT_STORE_ID,
    );

    expect({ after: (await detail("prod-drill")).preferredSupplier, before: before.preferredSupplier }).toEqual({
      after: { id: "cont-supplier", name: "Suministros Industriales CA" },
      before: { id: "cont-both", name: "Comercial Doble Via" },
    });
    expect((await list()).get("prod-drill")).toEqual({ id: "cont-supplier", name: "Suministros Industriales CA" });
  });

  it("el vendedor no ve proveedores: ni el listado ni el detalle le traen preferredSupplier", async () => {
    const vendedor = { "x-demo-role": "vendedor" };
    const products = await list(vendedor);

    expect({
      detail: "preferredSupplier" in (await detail("prod-cable", vendedor)),
      listed: [...products.values()].filter(Boolean),
      total: products.size > 0,
    }).toEqual({ detail: false, listed: [], total: true });
  });

  it("otra tienda no recibe el proveedor habitual de la tienda por defecto", async () => {
    const products = await list({ "x-demo-store-id": "00000000-0000-4000-8000-000000000002" });

    expect({ listed: [...products.values()].filter(Boolean), total: products.size > 0 }).toEqual({
      listed: [],
      total: true,
    });
  });
});
