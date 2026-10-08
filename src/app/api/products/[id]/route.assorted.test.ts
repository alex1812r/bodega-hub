/**
 * @jest-environment node
 */
/**
 * PRO-12 · receta surtida en el alta / edición de producto
 * (`packConversion.mode = "assorted"`) y su lectura en el detalle.
 */

import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "../route";
import { GET, PATCH } from "./route";

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

async function read(id: string) {
  const response = await GET(new Request(`http://localhost/api/products/${id}`), {
    params: Promise.resolve({ id }),
  });

  return (await response.json()).data;
}

function assorted(components: unknown[], extra: Record<string, unknown> = {}) {
  return { components, enabled: true, mode: "assorted", totalUnits: 6, ...extra };
}

async function issuesOf(response: Response) {
  const body = await response.json();

  return (body.error.issues as { message: string }[]).map((issue) => issue.message);
}

describe("/api/products/{id} · receta surtida", () => {
  beforeAll(() => {
    for (const [id, name] of [
      ["ra-pack", "Caja surtida"],
      ["ra-cola", "Refresco cola"],
      ["ra-naranja", "Refresco naranja"],
      ["ra-uva", "Refresco uva"],
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

  it("guarda la receta y el detalle la devuelve con components, totalUnits, label y kind", async () => {
    const response = await patch(
      "ra-pack",
      assorted(
        [
          { unitProductId: "ra-uva", unitsPerPack: 2 },
          { costWeight: 2.5, unitProductId: "ra-cola", unitsPerPack: 3 },
          { unitProductId: "ra-naranja", unitsPerPack: 1 },
        ],
        { label: "Surtido 6 sabores" },
      ),
    );
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.packConversion).toMatchObject({
      kind: "assorted",
      label: "Surtido 6 sabores",
      linkedProduct: { id: "ra-cola" },
      role: "pack",
      sources: [],
      totalUnits: 6,
      unitsPerPack: 6,
    });
    expect(data.packConversion.components).toEqual([
      { costWeight: 2.5, currentStock: 2, isActive: true, name: "Refresco cola", sku: "ra-cola", unitProductId: "ra-cola", unitsPerPack: 3 },
      { costWeight: 1, currentStock: 2, isActive: true, name: "Refresco naranja", sku: "ra-naranja", unitProductId: "ra-naranja", unitsPerPack: 1 },
      { costWeight: 1, currentStock: 2, isActive: true, name: "Refresco uva", sku: "ra-uva", unitProductId: "ra-uva", unitsPerPack: 2 },
    ]);

    const unit = await read("ra-uva");

    expect(unit.packConversion).toMatchObject({
      id: data.packConversion.id,
      linkedProduct: { id: "ra-pack" },
      role: "unit",
      sources: [
        { conversionId: data.packConversion.id, packName: "Caja surtida", packProductId: "ra-pack", totalUnits: 6, unitsPerPack: 2 },
      ],
      unitsPerPack: 2,
    });
  });

  it.each([
    [
      "la suma no es el total",
      assorted([{ unitProductId: "ra-cola", unitsPerPack: 3 }, { unitProductId: "ra-uva", unitsPerPack: 2 }]),
      "Los componentes suman 5 unidades y el empaque declara 6.",
    ],
    [
      "un producto repetido",
      assorted([{ unitProductId: "ra-cola", unitsPerPack: 3 }, { unitProductId: "ra-cola", unitsPerPack: 3 }]),
      "Un producto no puede repetirse entre los componentes del empaque.",
    ],
    [
      "un solo componente",
      assorted([{ unitProductId: "ra-cola", unitsPerPack: 6 }]),
      "Un empaque surtido lleva entre 2 y 20 componentes.",
    ],
    [
      "más de 20 componentes",
      assorted(
        Array.from({ length: 21 }, (_, index) => ({ unitProductId: `ra-x-${index}`, unitsPerPack: 1 })),
        { totalUnits: 21 },
      ),
      "Un empaque surtido lleva entre 2 y 20 componentes.",
    ],
    [
      "unidades que no son un entero positivo",
      assorted([{ unitProductId: "ra-cola", unitsPerPack: 0 }, { unitProductId: "ra-uva", unitsPerPack: 6 }]),
      "Las unidades de cada componente deben ser un entero mayor a cero.",
    ],
    [
      "un peso de costo que no es mayor a cero",
      assorted([
        { costWeight: 0, unitProductId: "ra-cola", unitsPerPack: 3 },
        { unitProductId: "ra-uva", unitsPerPack: 3 },
      ]),
      "El peso de costo de cada componente debe ser un número mayor a cero.",
    ],
    [
      "sin total de unidades",
      { components: [{ unitProductId: "ra-cola", unitsPerPack: 3 }, { unitProductId: "ra-uva", unitsPerPack: 3 }], enabled: true, mode: "assorted" },
      "Indica el total de unidades del empaque (mínimo 2).",
    ],
  ])("400 antes de tocar los datos: %s", async (_caso, packConversion, message) => {
    const before = (await read("ra-pack")).packConversion;

    const response = await patch("ra-pack", packConversion);

    expect(response.status).toBe(400);
    expect(await issuesOf(response)).toContain(message);
    expect((await read("ra-pack")).packConversion).toEqual(before);
  });

  it("400 si el propio empaque va entre los componentes", async () => {
    const response = await patch(
      "ra-pack",
      assorted([{ unitProductId: "ra-pack", unitsPerPack: 3 }, { unitProductId: "ra-uva", unitsPerPack: 3 }]),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("El empaque no puede ser componente de sí mismo.");
  });

  it("404 si un componente no existe y 409 si es un empaque con receta activa", async () => {
    const missing = await patch(
      "ra-pack",
      assorted([{ unitProductId: "no-existe", unitsPerPack: 3 }, { unitProductId: "ra-uva", unitsPerPack: 3 }]),
    );
    const chained = await patch(
      "ra-pack",
      assorted([{ unitProductId: "prod-cigar-pack", unitsPerPack: 3 }, { unitProductId: "ra-uva", unitsPerPack: 3 }]),
    );

    expect([missing.status, chained.status]).toEqual([404, 409]);
  });

  it("403 para un rol sin products.manage", async () => {
    const response = await patch(
      "ra-pack",
      assorted([{ unitProductId: "ra-cola", unitsPerPack: 3 }, { unitProductId: "ra-uva", unitsPerPack: 3 }]),
      "vendedor",
    );

    expect(response.status).toBe(403);
  });

  it("el alta de un producto acepta la receta surtida", async () => {
    const response = await POST(
      new Request("http://localhost/api/products", {
        body: JSON.stringify({
          name: "Caja surtida nueva",
          packConversion: assorted(
            [{ unitProductId: "ra-cola", unitsPerPack: 2 }, { unitProductId: "ra-naranja", unitsPerPack: 2 }],
            { totalUnits: 4 },
          ),
          salePriceRef: 9,
          sku: "ra-pack-nueva",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const { data } = await response.json();

    expect(response.status).toBe(201);
    expect(data.packConversion).toMatchObject({ kind: "assorted", role: "pack", totalUnits: 4 });
    expect(data.packConversion.components).toHaveLength(2);
  });

  it("el vínculo 1 a 1 de siempre sigue entrando igual y desactivar apaga el surtido", async () => {
    const single = await patch("ra-pack", {
      enabled: true,
      mode: "link_existing",
      unitProductId: "ra-naranja",
      unitsPerPack: 8,
    });
    const singleData = (await single.json()).data;

    expect(single.status).toBe(200);
    expect(singleData.packConversion).toMatchObject({
      kind: "single",
      linkedProduct: { id: "ra-naranja" },
      role: "pack",
      unitsPerPack: 8,
    });

    const disabled = await patch("ra-pack", { enabled: false });

    expect(disabled.status).toBe(200);
    expect((await disabled.json()).data.packConversion).toBeUndefined();
  });
});
