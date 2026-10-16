/**
 * @jest-environment node
 */

import * as mockSupplierProducts from "@/modules/contacts/services/supplierProducts.mock-server";
import { mockProductPackConversions, type ProductPackConversionMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { DELETE, PATCH } from "./route";

const context = (id: string, packId: string) => ({
  params: Promise.resolve({ id, packId }),
});

const demoHeaders = {
  "content-type": "application/json",
  "x-demo-role": "almacen",
};

describe("/api/supplier-products/[id]/pack-units/[packId]", () => {
  it("updates a pack unit", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/pack-units/sp-pack-cable-bulto", {
        body: JSON.stringify({ isDefault: true }),
        headers: demoHeaders,
        method: "PATCH",
      }),
      context("supp-prod-cable", "sp-pack-cable-bulto"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isDefault).toBe(true);
  });

  it("deactivates a pack unit", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/pack-units/sp-pack-cable-bulto", {
        headers: demoHeaders,
        method: "DELETE",
      }),
      context("supp-prod-cable", "sp-pack-cable-bulto"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isActive).toBe(false);
  });
});

describe("/api/supplier-products/[id]/pack-units/[packId] recipe sizes (D9)", () => {
  // prod-switch empieza sin receta; la receta de prueba lo vuelve componente de 6 u 12.
  const recipes: ProductPackConversionMock[] = [6, 12].map((size) => ({
    components: [{ costWeight: 1, unitProductId: "prod-switch", unitsPerPack: size }],
    id: `ppc-switch-${size}-test`,
    isActive: true,
    packProductId: `prod-switch-pack-${size}-test`,
    storeId: DEFAULT_STORE_ID,
    totalUnits: size,
    unitProductId: "prod-switch",
    unitsPerPack: size,
  }));
  let linkId = "";
  let legacyPackId = "";
  let packId = "";

  const patch = (id: string, body: Record<string, unknown>) =>
    PATCH(
      new Request(`http://localhost/api/supplier-products/${linkId}/pack-units/${id}`, {
        body: JSON.stringify(body),
        headers: demoHeaders,
        method: "PATCH",
      }),
      context(linkId, id),
    );

  beforeAll(() => {
    // Los ids del mock salen de Date.now(): dos altas en el mismo milisegundo chocarían.
    let tick = Date.now();
    const now = jest.spyOn(Date, "now").mockImplementation(() => ++tick);
    const service = mockSupplierProducts;
    linkId = service.createSupplierProduct({ productId: "prod-switch", supplierId: "cont-supplier-tools", supplierSku: undefined }, DEFAULT_STORE_ID).id;
    // Empaque creado antes de que existiera la receta: queda incompatible.
    legacyPackId = service.createSupplierProductPackUnit(linkId, { label: "Viejo", unitsPerPack: 10 }, DEFAULT_STORE_ID).id;
    mockProductPackConversions.push(...recipes);
    packId = service.createSupplierProductPackUnit(linkId, { label: "Caja", unitsPerPack: 6 }, DEFAULT_STORE_ID).id;
    now.mockRestore();
  });

  afterAll(() => {
    for (const recipe of recipes) {
      mockProductPackConversions.splice(mockProductPackConversions.indexOf(recipe), 1);
    }
  });

  it("rejects a size change that matches no recipe", async () => {
    const response = await patch(packId, { unitsPerPack: 10 });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe(
      "Este producto se arma en empaques de 6 o 12 unidades; 10 no coincide con ninguna receta.",
    );
  });

  it("accepts a size change to another recipe size", async () => {
    const response = await patch(packId, { unitsPerPack: 12 });

    expect(response.status).toBe(200);
    expect((await response.json()).data.unitsPerPack).toBe(12);
  });

  it("still renames and deactivates a legacy incompatible pack, but does not reactivate it", async () => {
    const renamed = await patch(legacyPackId, { label: "Viejo 10" });
    expect(renamed.status).toBe(200);

    const deactivated = await patch(legacyPackId, { isActive: false });
    expect(deactivated.status).toBe(200);

    const reactivated = await patch(legacyPackId, { isActive: true });
    expect(reactivated.status).toBe(400);
    expect((await reactivated.json()).error.message).toContain("10 no coincide con ninguna receta");
  });

  it("keeps updating sizes freely when the product has no recipe", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-hammer/pack-units/sp-pack-hammer-caja", {
        body: JSON.stringify({ unitsPerPack: 7 }),
        headers: demoHeaders,
        method: "PATCH",
      }),
      context("supp-prod-hammer", "sp-pack-hammer-caja"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.unitsPerPack).toBe(7);
  });
});
