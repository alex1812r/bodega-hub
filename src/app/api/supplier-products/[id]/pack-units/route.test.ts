/**
 * @jest-environment node
 */

import * as mockSupplierProducts from "@/modules/contacts/services/supplierProducts.mock-server";
import { mockProductPackConversions, type ProductPackConversionMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET, POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

const demoHeaders = {
  "content-type": "application/json",
  "x-demo-role": "almacen",
};

describe("/api/supplier-products/[id]/pack-units", () => {
  it("lists pack units", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/pack-units", {
        headers: demoHeaders,
      }),
      context("supp-prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.some((item: { label: string }) => item.label === "Bulto")).toBe(true);
  });

  it("creates a pack unit", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products/supp-prod-drill/pack-units", {
        body: JSON.stringify({ isDefault: true, label: "Paquete", unitsPerPack: 6 }),
        headers: demoHeaders,
        method: "POST",
      }),
      context("supp-prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.label).toBe("Paquete");
    expect(body.data.unitsPerPack).toBe(6);
  });
});

describe("/api/supplier-products/[id]/pack-units recipe sizes (D9)", () => {
  const extraRecipe: ProductPackConversionMock = {
    components: [{ costWeight: 1, unitProductId: "prod-cigar-unit", unitsPerPack: 12 }],
    id: "ppc-cigars-12-test",
    isActive: true,
    packProductId: "prod-cigar-pack-12-test",
    storeId: DEFAULT_STORE_ID,
    totalUnits: 12,
    unitProductId: "prod-cigar-unit",
    unitsPerPack: 12,
  };
  let unitLinkId = "";
  let packLinkId = "";

  const post = (linkId: string, unitsPerPack: number) =>
    POST(
      new Request(`http://localhost/api/supplier-products/${linkId}/pack-units`, {
        body: JSON.stringify({ label: "Caja", unitsPerPack }),
        headers: demoHeaders,
        method: "POST",
      }),
      context(linkId),
    );

  beforeAll(() => {
    // Los ids del mock salen de Date.now(): dos altas en el mismo milisegundo chocarían.
    let tick = Date.now();
    const now = jest.spyOn(Date, "now").mockImplementation(() => ++tick);
    const service = mockSupplierProducts;
    unitLinkId = service.createSupplierProduct({ productId: "prod-cigar-unit", supplierId: "cont-supplier", supplierSku: undefined }, DEFAULT_STORE_ID).id;
    packLinkId = service.createSupplierProduct({ productId: "prod-cigar-pack", supplierId: "cont-supplier", supplierSku: undefined }, DEFAULT_STORE_ID).id;
    now.mockRestore();
  });

  afterEach(() => {
    const index = mockProductPackConversions.indexOf(extraRecipe);
    if (index >= 0) mockProductPackConversions.splice(index, 1);
  });

  it("rejects a size that matches no recipe of the component product", async () => {
    mockProductPackConversions.push(extraRecipe);
    const response = await post(unitLinkId, 6);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe(
      "Este producto se arma en empaques de 10 o 12 unidades; 6 no coincide con ninguna receta.",
    );
  });

  it("accepts any size of a recipe of the component product", async () => {
    mockProductPackConversions.push(extraRecipe);
    const response = await post(unitLinkId, 12);

    expect(response.status).toBe(201);
    expect((await response.json()).data.unitsPerPack).toBe(12);
  });

  it("rejects a pack product size other than its recipe total", async () => {
    const response = await post(packLinkId, 20);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe(
      "Este producto es un empaque de 10 unidades según su receta; 20 no coincide con la receta.",
    );
  });

  it("accepts the pack product recipe total", async () => {
    const response = await post(packLinkId, 10);

    expect(response.status).toBe(201);
  });

  it("accepts any positive size when the product has no recipe", async () => {
    const response = await post("supp-prod-drill", 7);

    expect(response.status).toBe(201);
    expect((await response.json()).data.unitsPerPack).toBe(7);
  });
});
