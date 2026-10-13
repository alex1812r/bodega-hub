/**
 * @jest-environment node
 */

import { updateContact } from "@/modules/contacts/services/contacts.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET, PUT } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

type PutOptions = { raw?: string; role?: string; storeId?: string };

function put(id: string, body: unknown, options: PutOptions = {}) {
  return PUT(
    new Request(`http://localhost/api/products/${id}/suppliers`, {
      body: options.raw ?? JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-demo-role": options.role ?? "admin",
        ...(options.storeId ? { "x-demo-store-id": options.storeId } : {}),
      },
      method: "PUT",
    }),
    context(id),
  );
}

async function activeLinks(id: string) {
  const response = await GET(
    new Request(`http://localhost/api/products/${id}/suppliers?isActive=true&limit=100`),
    context(id),
  );
  const body = await response.json();

  return (body.data.items as { isPreferred: boolean; supplierId: string }[])
    .map((item) => `${item.supplierId}${item.isPreferred ? "*" : ""}`)
    .sort();
}

describe("/api/products/[id]/suppliers", () => {
  it("returns suppliers for a product", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-cable/suppliers"),
      context("prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });

  it("forbids vendedor from listing product suppliers", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-cable/suppliers", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("prod-cable"),
    );

    expect(response.status).toBe(403);
  });

  it("GET expone isPreferred en cada vínculo: el único proveedor del producto es el habitual", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-cable/suppliers"),
      context("prod-cable"),
    );
    const body = await response.json();

    expect(
      body.data.items.map((item: { isPreferred: boolean; supplierId: string }) => ({
        isPreferred: item.isPreferred,
        supplierId: item.supplierId,
      })),
    ).toEqual([{ isPreferred: true, supplierId: "cont-supplier" }]);
  });
});

describe("PUT /api/products/[id]/suppliers", () => {
  it("200: guarda el estado deseado en una llamada y responde suppliers, preferredSupplierId y preferredChanged", async () => {
    const response = await put("prod-latex", {
      suppliers: [
        { costRef: 3.456, supplierId: "cont-supplier", supplierSku: " LAT-01 " },
        { isPreferred: true, supplierId: "cont-both" },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect({
      ...body.data,
      suppliers: body.data.suppliers.map(
        (link: { costRef: number; isPreferred: boolean; supplierId: string; supplierSku?: string }) => ({
          costRef: link.costRef,
          isPreferred: link.isPreferred,
          supplierId: link.supplierId,
          supplierSku: link.supplierSku,
        }),
      ),
    }).toEqual({
      preferredAutoAssigned: false,
      preferredChanged: true,
      preferredSupplierId: "cont-both",
      previousPreferredSupplierId: null,
      suppliers: [
        { costRef: 0, isPreferred: true, supplierId: "cont-both", supplierSku: undefined },
        { costRef: 3.46, isPreferred: false, supplierId: "cont-supplier", supplierSku: "lat-01" },
      ],
    });
    expect(await activeLinks("prod-latex")).toEqual(["cont-both*", "cont-supplier"]);
  });

  it("200: quitar el habitual sin marcar otro lo pasa al primero de la lista y la respuesta lo indica; lista vacía deja el producto sin habitual", async () => {
    await put("prod-latex", {
      suppliers: [{ supplierId: "cont-supplier" }, { isPreferred: true, supplierId: "cont-both" }],
    });

    const moved = await (await put("prod-latex", { suppliers: [{ supplierId: "cont-supplier" }] })).json();
    const emptied = await (await put("prod-latex", { suppliers: [] })).json();

    expect({
      emptied: {
        autoAssigned: emptied.data.preferredAutoAssigned,
        changed: emptied.data.preferredChanged,
        preferred: emptied.data.preferredSupplierId,
        suppliers: emptied.data.suppliers,
      },
      links: await activeLinks("prod-latex"),
      moved: {
        autoAssigned: moved.data.preferredAutoAssigned,
        changed: moved.data.preferredChanged,
        preferred: moved.data.preferredSupplierId,
        previous: moved.data.previousPreferredSupplierId,
      },
    }).toEqual({
      emptied: { autoAssigned: true, changed: true, preferred: null, suppliers: [] },
      links: [],
      moved: { autoAssigned: true, changed: true, preferred: "cont-supplier", previous: "cont-both" },
    });
  });

  it("200: el mismo proveedor dos veces se funde en una fila", async () => {
    const response = await put("prod-latex", {
      suppliers: [
        { costRef: 1, isPreferred: true, supplierId: "cont-supplier" },
        { costRef: 2, supplierId: "cont-supplier" },
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.suppliers.map((link: { costRef: number; isPreferred: boolean; supplierId: string }) => ({
        costRef: link.costRef,
        isPreferred: link.isPreferred,
        supplierId: link.supplierId,
      })),
    ).toEqual([{ costRef: 2, isPreferred: true, supplierId: "cont-supplier" }]);
  });

  it("400 antes de escribir: cuerpo sin lista, costo negativo, dos habituales y más de 50", async () => {
    await put("prod-latex", { suppliers: [{ isPreferred: true, supplierId: "cont-supplier" }] });

    const noList = await put("prod-latex", {});
    const negative = await put("prod-latex", { suppliers: [{ costRef: -1, supplierId: "cont-both" }] });
    const twoPreferred = await put("prod-latex", {
      suppliers: [
        { isPreferred: true, supplierId: "cont-supplier" },
        { isPreferred: true, supplierId: "cont-both" },
      ],
    });
    const tooMany = await put("prod-latex", {
      suppliers: Array.from({ length: 51 }, () => ({ supplierId: "cont-both" })),
    });

    expect({
      links: await activeLinks("prod-latex"),
      messages: [
        (await noList.json()).error.issues[0].message,
        (await negative.json()).error.issues[0].message,
        (await twoPreferred.json()).error.message,
        (await tooMany.json()).error.issues[0].message,
      ],
      statuses: [noList.status, negative.status, twoPreferred.status, tooMany.status],
    }).toEqual({
      links: ["cont-supplier*"],
      messages: [
        "La lista de proveedores no es válida.",
        "El costo del proveedor no puede ser negativo.",
        "Solo un proveedor puede ser el habitual del producto.",
        "Un producto admite como máximo 50 proveedores.",
      ],
      statuses: [400, 400, 400, 400],
    });
  });

  it("400: contacto que no es proveedor, proveedor inexistente y proveedor inactivo (vínculo nuevo o marcado habitual)", async () => {
    await put("prod-latex", { suppliers: [{ isPreferred: true, supplierId: "cont-supplier" }] });
    updateContact("cont-supplier-tools", { isActive: false }, DEFAULT_STORE_ID);

    const customer = await put("prod-latex", { suppliers: [{ supplierId: "cont-customer" }] });
    const missing = await put("prod-latex", { suppliers: [{ supplierId: "no-existe" }] });
    const inactiveNew = await put("prod-latex", {
      suppliers: [{ supplierId: "cont-supplier" }, { supplierId: "cont-supplier-tools" }],
    });
    const inactivePreferred = await put("prod-latex", {
      suppliers: [{ supplierId: "cont-supplier" }, { isPreferred: true, supplierId: "cont-supplier-tools" }],
    });

    updateContact("cont-supplier-tools", { isActive: true }, DEFAULT_STORE_ID);

    expect({
      links: await activeLinks("prod-latex"),
      messages: [
        (await customer.json()).error.message,
        (await missing.json()).error.message,
        (await inactiveNew.json()).error.message,
        (await inactivePreferred.json()).error.message,
      ],
      statuses: [customer.status, missing.status, inactiveNew.status, inactivePreferred.status],
    }).toEqual({
      links: ["cont-supplier*"],
      messages: [
        "Proveedor no encontrado.",
        "Proveedor no encontrado.",
        "El proveedor Herramientas del Lago está inactivo: no se puede vincular al producto.",
        "El proveedor Herramientas del Lago está inactivo: no se puede vincular al producto.",
      ],
      statuses: [400, 400, 400, 400],
    });
  });

  it("403: vendedor y contador no guardan proveedores; almacén sí", async () => {
    const body = { suppliers: [{ supplierId: "cont-supplier" }] };

    const statuses = [
      (await put("prod-latex", body, { role: "vendedor" })).status,
      (await put("prod-latex", body, { role: "contador" })).status,
      (await put("prod-latex", body, { role: "almacen" })).status,
    ];

    expect(statuses).toEqual([403, 403, 200]);
  });

  it("404 con un producto inexistente; un producto de otra tienda responde 403 y no se toca", async () => {
    const missing = await put("no-existe", { suppliers: [] });
    const foreign = await put("prod-cable", { suppliers: [] }, { storeId: OTHER_STORE_ID });

    expect([missing.status, foreign.status]).toEqual([404, 403]);
    expect(await activeLinks("prod-cable")).toEqual(["cont-supplier*"]);
  });

  it("otra tienda: no puede vincular a su producto un proveedor de la tienda por defecto", async () => {
    const response = await put(
      "prod-sur-arroz",
      { suppliers: [{ supplierId: "cont-supplier" }] },
      { storeId: OTHER_STORE_ID },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Proveedor no encontrado.");
  });
});
