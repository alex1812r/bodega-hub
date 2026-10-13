import {
  missingRecipeOnCreateMessage,
  missingRecipeOnReceiveMessage,
  receivePurchaseBodySchema,
  toRpcDisassembleList,
} from "./purchaseDisassemble";

const KEY = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

describe("receivePurchaseBodySchema (COM-14)", () => {
  it("el cuerpo vacío es válido: recibir como siempre", () => {
    expect(receivePurchaseBodySchema.parse({})).toEqual({});
  });

  it("acepta la clave, la lista vacía y líneas con o sin reparto", () => {
    const body = {
      clientRequestId: KEY,
      disassemble: [
        { distribution: [{ unitProductId: "u1", units: 0 }, { unitProductId: "u2", units: 12 }], purchaseItemId: "i1" },
        { purchaseItemId: "i2" },
      ],
    };

    expect(receivePurchaseBodySchema.parse(body)).toEqual(body);
    expect(receivePurchaseBodySchema.parse({ disassemble: [] })).toEqual({ disassemble: [] });
  });

  it("descarta lo que no es del contrato: la tienda nunca sale del cuerpo", () => {
    expect(receivePurchaseBodySchema.parse({ storeId: "otra-tienda" })).toEqual({});
  });

  it.each([
    ["clave que no es uuid", { clientRequestId: "abc" }],
    ["lista que no es una lista", { disassemble: "todas" }],
    ["línea sin purchaseItemId", { disassemble: [{}] }],
    ["reparto vacío", { disassemble: [{ distribution: [], purchaseItemId: "i1" }] }],
    ["unidades negativas", { disassemble: [{ distribution: [{ unitProductId: "u1", units: -1 }], purchaseItemId: "i1" }] }],
    ["unidades con decimales", { disassemble: [{ distribution: [{ unitProductId: "u1", units: 1.5 }], purchaseItemId: "i1" }] }],
  ])("rechaza %s", (_title, body) => {
    expect(receivePurchaseBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("toRpcDisassembleList", () => {
  it("traduce la lista a p_disassemble: components solo en las líneas con reparto, en el orden enviado", () => {
    expect(
      toRpcDisassembleList([
        { distribution: [{ unitProductId: "u2", units: 3 }, { unitProductId: "u1", units: 0 }], purchaseItemId: "i1" },
        { purchaseItemId: "i2" },
      ]),
    ).toEqual([
      { components: [{ unit_product_id: "u2", units: 3 }, { unit_product_id: "u1", units: 0 }], purchase_item_id: "i1" },
      { purchase_item_id: "i2" },
    ]);
  });
});

describe("mensajes de receta ausente (los de la base)", () => {
  it("nombran los productos y dicen qué hacer", () => {
    expect(missingRecipeOnCreateMessage(["Caja A", "Caja B"])).toBe(
      "Sin receta de apertura activa: Caja A, Caja B. No se puede marcar «Desarmar al recibir» en esas líneas",
    );
    expect(missingRecipeOnReceiveMessage(["Caja A"])).toBe(
      "Sin receta de apertura activa: Caja A. Desmarca «Desarmar al recibir» en esas líneas o activa su receta",
    );
  });
});
