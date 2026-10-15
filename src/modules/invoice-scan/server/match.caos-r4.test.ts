/**
 * SCN-05a-F5 · CAOS ronda 4 (emparejamiento): A-r4-1 (costo desde el total de
 * la línea), M-r4-1 (componente de receta), B-r4-1 (receta en "unidad") y
 * B-r4-2 (SKU contra alias exacto de otro producto).
 */
import type { InvoiceExtractionLine } from "../contracts";

import { buildContext, buildExtraction, buildLine, products, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import { UNIT_PRICE_MISMATCH_ISSUE } from "./match/money";
import type { MatchContext } from "./match.types";

function withoutLastCost(id: string): Partial<MatchContext> {
  return { products: products.map((p) => (p.id === id ? { ...p, lastUnitCostRef: null } : p)) };
}

function one(line: Partial<InvoiceExtractionLine>, ctx: MatchContext = buildContext()) {
  return matchInvoice(buildExtraction({ lines: [buildLine(line)] }), ctx);
}

const aceiteCaja12 = { description: "ACEITE VATEL 1L CAJA X12", supplierSku: "ACE-1", unit: "caja", unitsPerPack: 12 } as const;
const cajaMalta = { description: "CAJA MALTA POLAR X36", supplierSku: "CMX36" } as const;

describe("A-r4-1 · costo por unidad de entrada desde lineTotal, conciliado con unitPrice", () => {
  it("MONEY-1: 2 cajas x12, P.UNIT 100 por unidad, TOTAL 2400 → confirmada, 1200 por caja (subtotal 2400)", () => {
    const result = one(
      { ...aceiteCaja12, quantity: 2, unitPrice: 100, lineTotal: 2400 },
      buildContext(withoutLastCost("p-aceite")),
    );
    const line = result.lines[0];

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", unitsPerPack: 12, unitCostVes: 1200, unitCostRef: 12, issues: [] });
    expect(line.unitCostVes! * 2).toBe(result.totals.computed);
  });

  it("NP1: aceite caja x12, 2 a 250 por unidad, total 6000, con último costo → 3000 por caja, sin aviso", () => {
    const line = one({ ...aceiteCaja12, quantity: 2, unitPrice: 250, lineTotal: 6000 }).lines[0];

    expect(line).toMatchObject({ status: "confirmed", unitCostVes: 3000, issues: [] });
  });

  it("precio impreso por caja (2 a 3000, total 6000) → coherente, 3000 por caja", () => {
    const line = one({ ...aceiteCaja12, quantity: 2, unitPrice: 3000, lineTotal: 6000 }).lines[0];

    expect(line).toMatchObject({ status: "confirmed", unitCostVes: 3000, issues: [] });
  });

  it("RP7: receta x36, 2 cajas, P.UNIT 50 por botella, total 3600 → confirmada, 1800 por empaque", () => {
    const line = one({ ...cajaMalta, quantity: 2, unitPrice: 50, lineTotal: 3600 }).lines[0];

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", unitsPerPack: 36, unitCostVes: 1800, issues: [] });
  });

  it.each([
    ["NP2: 12 u, P.UNIT 600 (era el total), total 600", 600],
    ["NP4: 12 u, P.UNIT 5000, total 600", 5000],
  ])("%s → dudosa con aviso, costo desde el total (50)", (_label, unitPrice) => {
    const line = one({ description: "MALTA POLAR 355 ML", quantity: 12, unitPrice, lineTotal: 600 }).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toEqual([UNIT_PRICE_MISMATCH_ISSUE]);
    expect(line.unitCostVes).toBe(50);
    expect(line.unitCostRef).toBe(0.5);
  });

  it("MONEY-3: modo unidad, 12 u, P.UNIT 1200, TOTAL 1200, sin último costo → dudosa, 100 por unidad", () => {
    const line = one(
      { description: "MALTA POLAR 355 ML", quantity: 12, unitPrice: 1200, lineTotal: 1200 },
      buildContext(withoutLastCost("p-malta")),
    ).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain(UNIT_PRICE_MISMATCH_ISSUE);
    expect(line.unitCostVes).toBe(100);
  });

  it("modo empaque, ni por empaque ni por unidad dentro (2 cajas x12, P.UNIT 700, total 2400) → dudosa", () => {
    const line = one(
      { ...aceiteCaja12, quantity: 2, unitPrice: 700, lineTotal: 2400 },
      buildContext(withoutLastCost("p-aceite")),
    ).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toEqual([UNIT_PRICE_MISMATCH_ISSUE]);
    expect(line.unitCostVes).toBe(1200);
  });

  it("redondeo del precio impreso dentro de la tolerancia (3 a 33,33, total 100) → confirmada", () => {
    const line = one({ description: "MALTA POLAR 355 ML", quantity: 3, unitPrice: 33.33, lineTotal: 100 }).lines[0];

    expect(line).toMatchObject({ status: "confirmed", unitCostVes: 33.33, issues: [] });
  });

  it("sin lineTotal válido: usa unitPrice y la coherencia contra el último costo sigue (RP8 / RP9)", () => {
    const ok = one({ ...cajaMalta, quantity: 2, unitPrice: 1800, lineTotal: 0 }).lines[0];
    expect(ok).toMatchObject({ status: "confirmed", unitCostVes: 1800, issues: [] });

    const perBottle = one({ ...cajaMalta, quantity: 2, unitPrice: 50, lineTotal: 0 }).lines[0];
    expect(perBottle.status).toBe("doubtful");
    expect(perBottle.unitCostVes).toBe(50);
    expect(perBottle.issues[0]).toMatch(/^¿Precio por caja o por unidad\?/);
  });

  it("la suma de unitCostVes × cantidad cuadra con totals.computed (redondeo al céntimo por unidad)", () => {
    const lines = [
      buildLine({ ...aceiteCaja12, quantity: 2, unitPrice: 250, lineTotal: 6000 }),
      buildLine({ ...cajaMalta, quantity: 2, unitPrice: 50, lineTotal: 3600 }),
      buildLine({ description: "MALTA POLAR 355 ML", quantity: 12, unitPrice: 600, lineTotal: 600 }),
      buildLine({ description: "MALTA POLAR 355 ML", quantity: 3, unitPrice: 33.33, lineTotal: 100 }),
      buildLine({ description: "MALTA POLAR 355 ML", quantity: 12, unitPrice: 50, lineTotal: 0 }),
    ];
    const result = matchInvoice(buildExtraction({ lines }), buildContext());
    const sum = result.lines.reduce((acc, line, index) => acc + (line.unitCostVes ?? 0) * lines[index].quantity, 0);
    const slack = lines.reduce((acc, line) => acc + 0.005 * line.quantity, 0);

    expect(result.totals.computed).toBe(6000 + 3600 + 600 + 100 + 600);
    expect(Math.abs(sum - result.totals.computed)).toBeLessThanOrEqual(slack);
  });
});

describe("M-r4-1 · componente de receta con empaque del proveedor de otro tamaño", () => {
  function componentCtx(packSizes: number[]): MatchContext {
    const ctx = buildContext();
    ctx.products = [
      ...ctx.products,
      {
        id: "p-azucar",
        name: "Azúcar 1 kg",
        sku: "AZU-001",
        barcode: null,
        active: true,
        taxRateCode: "exento",
        lastUnitCostRef: null,
        hasRecipe: false,
        componentPackSizes: [12],
      },
    ];
    const catalog = ctx.supplierCatalogs[SUPPLIER_POLAR];
    catalog.supplierProducts.push({ supplierProductId: "sp-azucar", productId: "p-azucar", supplierSku: "AZU-1" });
    catalog.packUnits.push(
      ...packSizes.map((size) => ({ id: `pu-azucar-${size}`, productId: "p-azucar", label: `Bulto x${size}`, unitsPerPack: size })),
    );
    return ctx;
  }
  const azucar = { description: "AZUCAR 1KG BULTO", supplierSku: "AZU-1", quantity: 2, unitPrice: 2400, lineTotal: 4800 } as const;

  it.each<[string, Partial<InvoiceExtractionLine>]>([
    ["C-1 bulto upp 24", { unit: "bulto", unitsPerPack: 24 }],
    ["C-2 bulto sin upp (único empaque x24)", { unit: "bulto" }],
  ])("%s → dudosa con aviso que nombra el tamaño permitido (12)", (_label, extra) => {
    const line = one({ ...azucar, ...extra }, componentCtx([24])).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.entryMode).toBe("pack");
    expect(line.issues).toContain(
      "El empaque es de 24 unidades, pero este producto es componente de una receta de 12 unidades por empaque: confirma las unidades por empaque (la compra solo acepta 12).",
    );
  });

  it("C-6 empaque x12 del proveedor, bulto upp 12 → confirmada pack 12", () => {
    const line = one({ ...azucar, unit: "bulto", unitsPerPack: 12, unitPrice: 1200, lineTotal: 2400 }, componentCtx([12])).lines[0];

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", unitsPerPack: 12, packUnitId: "pu-azucar-12", issues: [] });
  });

  it("componente en unidades sueltas: modo unidad, sin aviso", () => {
    const line = one({ description: "AZUCAR 1KG", supplierSku: "AZU-1", unit: "unidad", quantity: 24, unitPrice: 100, lineTotal: 2400 }, componentCtx([24])).lines[0];

    expect(line).toMatchObject({ status: "confirmed", entryMode: "unit", issues: [] });
  });
});

describe("B-r4-1 · producto con receta y la factura dice unidad", () => {
  it("24 UND de la caja x36 → dudosa con aviso, propone la conversión", () => {
    const line = one(
      { ...cajaMalta, unit: "unidad", quantity: 24, unitPrice: 1800, lineTotal: 43200 },
      buildContext(withoutLastCost("p-caja-malta")),
    ).lines[0];

    expect(line).toMatchObject({ status: "doubtful", entryMode: "pack", unitsPerPack: 36, disassembleOnReceive: true });
    expect(line.issues).toContain(
      'La factura dice "unidad" y el producto es un empaque de 36 unidades: confirma si son empaques o unidades sueltas.',
    );
  });
});

describe("B-r4-2 · SKU frente a un alias exacto del mismo texto que apunta a otro producto", () => {
  it("BH6: SKU → harina, alias exacto → malta: dudosa con ambos candidatos", () => {
    const ctx = buildContext();
    const catalog = ctx.supplierCatalogs[SUPPLIER_POLAR];
    catalog.supplierProducts = catalog.supplierProducts.map((sp) => (sp.productId === "p-harina" ? { ...sp, supplierSku: "HAR-20" } : sp));
    catalog.aliases = [
      { aliasNorm: "harina pan 1kg bulto", productId: "p-harina", packLabel: "BULTO", unitsPerPack: 20, hits: 2 },
      { aliasNorm: "harina pan bulto", productId: "p-malta", packLabel: null, unitsPerPack: null, hits: 9 },
    ];
    const line = one({ description: "HARINA PAN BULTO", supplierSku: "HAR-20", quantity: 1, unitPrice: 2400, lineTotal: 2400 }, ctx).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates?.map((candidate) => candidate.productId)).toEqual(["p-harina", "p-malta"]);
  });
});
