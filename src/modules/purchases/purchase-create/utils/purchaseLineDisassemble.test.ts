import { createUnitDraftItem, type PurchaseWebLine } from "../types";
import {
  purchaseLineDisassemblePayload,
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

describe("purchaseLineDisassemblePayload (COM-14)", () => {
  it("la clave solo viaja cuando la línea está marcada", () => {
    expect(purchaseLineDisassemblePayload({ disassemble: true })).toEqual({ disassembleOnReceive: true });
    expect(purchaseLineDisassemblePayload({ disassemble: false })).toEqual({});
    expect(purchaseLineDisassemblePayload({})).toEqual({});
  });
});
