import { createUnitDraftItem, type PurchaseWebLine } from "../types";
import { buildDuplicatedPurchaseLines } from "./duplicatePurchase";
import {
  purchaseLineDisassemblePayload,
  readPurchasePackRecipes,
  withPurchaseLineDisassemble,
} from "./purchaseLineDisassemble";

function line(id: string, productId: string): PurchaseWebLine {
  return {
    changes: [],
    edited: false,
    editedMark: false,
    item: createUnitDraftItem({ id, productId, rateVes: 500, taxRate: 0, unitCostRef: 1 }),
    locked: false,
    tax: { categoryCode: "exento", code: "exento", label: "Exento", manual: false, rate: 0 },
  };
}

describe("withPurchaseLineDisassemble (COM-14)", () => {
  const lines = [line("l-caja", "prod-caja"), line("l-harina", "prod-harina"), line("l-bulto", "prod-bulto")];
  const packs = new Set(["prod-caja", "prod-bulto"]);

  it("solo las líneas de un empaque con receta llevan `disassemble`: true si están marcadas, false si no", () => {
    const result = withPurchaseLineDisassemble(lines, { "l-caja": true }, packs);

    expect(result.map((item) => item.disassemble)).toEqual([true, undefined, false]);
    expect("disassemble" in (result[1] ?? {})).toBe(false);
  });

  it("una marca guardada sobre un producto que ya no tiene receta se ignora", () => {
    const result = withPurchaseLineDisassemble(lines, { "l-harina": true }, packs);

    expect(result[1]).toBe(lines[1]);
    expect(result.map(purchaseLineDisassemblePayload)).toEqual([{}, {}, {}]);
  });

  it("sin marcas o sin recetas cargadas nadie queda marcado", () => {
    expect(withPurchaseLineDisassemble(lines, undefined, packs).map((item) => item.disassemble)).toEqual([
      false,
      undefined,
      false,
    ]);
    expect(withPurchaseLineDisassemble(lines, { "l-caja": true }, new Set())).toEqual(lines);
  });
});

describe("withPurchaseLineDisassemble · preferencia «Desarmar siempre al recibir compras»", () => {
  const lines = [line("l-caja", "prod-caja"), line("l-harina", "prod-harina"), line("l-bulto", "prod-bulto")];
  const packs = new Set(["prod-caja", "prod-bulto"]);
  const always = new Set(["prod-caja"]);

  it("la línea que el usuario no ha tocado nace marcada si la receta de su empaque tiene la preferencia", () => {
    const result = withPurchaseLineDisassemble(lines, undefined, packs, always);

    expect(result.map((item) => item.disassemble)).toEqual([true, undefined, false]);
    expect(result.map(purchaseLineDisassemblePayload)).toEqual([{ disassembleOnReceive: true }, {}, {}]);
  });

  it("lo que el usuario eligió manda: desmarcada a mano no viaja marcada; marcada a mano sin preferencia, sí", () => {
    const result = withPurchaseLineDisassemble(lines, { "l-bulto": true, "l-caja": false }, packs, always);

    expect(result.map((item) => item.disassemble)).toEqual([false, undefined, true]);
    expect(result.map(purchaseLineDisassemblePayload)).toEqual([{}, {}, { disassembleOnReceive: true }]);
  });

  it("la preferencia de un producto que ya no tiene receta activa no marca nada", () => {
    expect(withPurchaseLineDisassemble(lines, undefined, new Set(), always)).toEqual(lines);
  });

  it("compra duplicada: las líneas llegan sin marca y aplican la preferencia ACTUAL de la receta", () => {
    let sequence = 0;
    const { lines: duplicated } = buildDuplicatedPurchaseLines(
      [
        {
          productId: "prod-caja",
          purchaseId: "purchase-1",
          quantity: 3,
          subtotalRef: 27,
          subtotalVes: 13500,
          unitCostRef: 9,
          unitCostVes: 4500,
        },
      ],
      new Map([
        [
          "prod-caja",
          {
            product: {
              costWithTaxRef: 9,
              currentStock: 0,
              link: "linked",
              name: "Caja de refrescos",
              packUnits: [],
              productId: "prod-caja",
              sku: "BEB-CAJ-006",
              taxRate: 0,
              unitCostRef: 9,
            },
            status: "active",
          },
        ],
      ]),
      { costCurrency: "ref", nextId: () => `line-${(sequence += 1)}`, rateVes: 500 },
    );
    const webLines = duplicated.items.map((item) => ({ ...line(item.id, item.productId), item }));

    expect(duplicated.disassemble).toBeUndefined();
    expect(
      withPurchaseLineDisassemble(webLines, duplicated.disassemble, packs, always).map((item) => item.disassemble),
    ).toEqual([true]);
    expect(
      withPurchaseLineDisassemble(webLines, duplicated.disassemble, packs).map((item) => item.disassemble),
    ).toEqual([false]);
  });
});

describe("readPurchasePackRecipes (COM-14)", () => {
  it("separa los empaques con receta de los que además piden desarmar siempre", () => {
    const result = readPurchasePackRecipes([
      { alwaysDisassembleOnReceive: true, packProduct: { id: "prod-caja" } },
      { packProduct: { id: "prod-bulto" } },
      { alwaysDisassembleOnReceive: false, packProduct: { id: "prod-saco" } },
    ]);

    expect([...result.packProductIds]).toEqual(["prod-caja", "prod-bulto", "prod-saco"]);
    expect([...result.alwaysDisassembleProductIds]).toEqual(["prod-caja"]);
  });

  it("una respuesta que no es la lista esperada no tumba el formulario: dos conjuntos vacíos", () => {
    for (const data of [undefined, null, { data: [] }, "x", [null, {}, { packProduct: {} }]]) {
      const result = readPurchasePackRecipes(data);

      expect(result.packProductIds.size).toBe(0);
      expect(result.alwaysDisassembleProductIds.size).toBe(0);
    }
  });
});

describe("purchaseLineDisassemblePayload (COM-14)", () => {
  it("la clave solo viaja cuando la línea está marcada", () => {
    expect(purchaseLineDisassemblePayload({ disassemble: true })).toEqual({ disassembleOnReceive: true });
    expect(purchaseLineDisassemblePayload({ disassemble: false })).toEqual({});
    expect(purchaseLineDisassemblePayload({})).toEqual({});
  });
});
