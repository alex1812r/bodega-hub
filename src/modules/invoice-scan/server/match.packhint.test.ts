import { buildContext, buildExtraction, buildLine, products, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import type { InvoiceExtractionLine } from "../contracts";
import type { MatchAlias, MatchContext, MatchPackUnit, MatchProduct } from "./match.types";

/**
 * Caos ronda 2 A-n1: una palabra de empaque solo en el texto ("LECHE COMPLETA
 * CAJA 1L", "DOC 123") o `unit: "otro"` sin número, con un único empaque
 * registrado, no confirma por sí sola; el alias aprendido en modo unidad manda.
 */
const extra: MatchProduct[] = [
  { id: "p-fosforo", name: "Fosforos El Sol caja", sku: "FOS", barcode: null, active: true, taxRateCode: "general", lastUnitCostRef: null, hasRecipe: false },
  { id: "p-leche", name: "Leche completa caja 1L", sku: "LEC", barcode: null, active: true, taxRateCode: "exento", lastUnitCostRef: null, hasRecipe: false },
  { id: "p-queso", name: "Queso blanco", sku: "QUE", barcode: null, active: true, taxRateCode: "exento", lastUnitCostRef: null, hasRecipe: false },
];

const BULTO_LECHE: MatchPackUnit = { id: "pu-lec-12", productId: "p-leche", label: "Bulto x12", unitsPerPack: 12 };

function ctxWith(packUnits: MatchPackUnit[], aliases: MatchAlias[] = []): MatchContext {
  return buildContext({
    products: [...products, ...extra],
    supplierCatalogs: {
      [SUPPLIER_POLAR]: {
        supplierProducts: [
          { supplierProductId: "sp-fos", productId: "p-fosforo", supplierSku: "FOS-1" },
          { supplierProductId: "sp-lec", productId: "p-leche", supplierSku: "LEC-1" },
          { supplierProductId: "sp-que", productId: "p-queso", supplierSku: "QUE-1" },
        ],
        aliases,
        packUnits,
      },
    },
  });
}

function one(line: Partial<InvoiceExtractionLine>, ctx: MatchContext) {
  return matchInvoice(buildExtraction({ lines: [buildLine(line)] }), ctx).lines[0];
}

const leche = { rawText: "LEC-1 LECHE COMPLETA CAJA 1L", description: "LECHE COMPLETA CAJA 1L", supplierSku: "LEC-1", quantity: 12, unitPrice: 40, lineTotal: 480 };

describe("matchInvoice · palabra de empaque solo en el texto (caos A-n1)", () => {
  it.each<[string, Partial<InvoiceExtractionLine>, MatchPackUnit]>([
    [
      "E2 'FOSFOROS EL SOL CAJA' con Paquete x10",
      { rawText: "FOS-1 FOSFOROS EL SOL CAJA", description: "FOSFOROS EL SOL CAJA", supplierSku: "FOS-1", quantity: 10, unitPrice: 50, lineTotal: 500 },
      { id: "pu-fos-10", productId: "p-fosforo", label: "Paquete x10", unitsPerPack: 10 },
    ],
    ["E3 'LECHE COMPLETA CAJA 1L' con Bulto x12", leche, BULTO_LECHE],
    [
      "E5 'LECHE 1L DOC 123' con Bulto x12",
      { ...leche, rawText: "LEC-1 LECHE 1L DOC 123", description: "LECHE 1L" },
      BULTO_LECHE,
    ],
    [
      "E6 unit 'otro' para 'QUESO BLANCO 3 KG' con Pieza x5",
      { rawText: "QUE-1 QUESO BLANCO 3 KG", description: "QUESO BLANCO", supplierSku: "QUE-1", unit: "otro", quantity: 3, unitPrice: 300, lineTotal: 900 },
      { id: "pu-que-5", productId: "p-queso", label: "Pieza x5", unitsPerPack: 5 },
    ],
  ])("%s: dudosa con el empaque único propuesto y aviso, nunca confirmada", (_name, line, pack) => {
    const result = one(line, ctxWith([pack]));

    expect(result.status).toBe("doubtful");
    expect(result.entryMode).toBe("pack");
    expect(result.packUnitId).toBe(pack.id);
    expect(result.issues.join(" ")).toContain(pack.label);
  });

  it("E4 control: unit 'unidad' sigue en modo unidad confirmada", () => {
    const result = one({ ...leche, unit: "unidad" }, ctxWith([BULTO_LECHE]));

    expect(result).toMatchObject({ status: "confirmed", entryMode: "unit" });
    expect(result.unitsPerPack).toBeUndefined();
  });

  it("unit 'caja' declarado por la factura y un solo empaque: ese, confirmada (plan §3)", () => {
    const result = one({ ...leche, unit: "caja", quantity: 1, unitPrice: 480, lineTotal: 480 }, ctxWith([BULTO_LECHE]));

    expect(result).toMatchObject({ status: "confirmed", entryMode: "pack", packUnitId: "pu-lec-12", unitsPerPack: 12 });
  });
});

describe("matchInvoice · el alias del proveedor manda sobre la palabra del texto (caos A-n1)", () => {
  const lecheSinSku = { rawText: "LECHE COMPLETA CAJA 1L", description: "LECHE COMPLETA CAJA 1L", quantity: 12, unitPrice: 40, lineTotal: 480 };

  it("P1 alias aprendido 7 veces en modo unidad + Bulto x12, unit omitido: modo unidad confirmada, sin multiplicar", () => {
    const alias: MatchAlias = { aliasNorm: "leche completa caja 1l", productId: "p-leche", packLabel: null, unitsPerPack: null, hits: 7 };
    const result = one(lecheSinSku, ctxWith([BULTO_LECHE], [alias]));

    expect(result.productId).toBe("p-leche");
    expect(result).toMatchObject({ status: "confirmed", entryMode: "unit" });
    expect(result.unitsPerPack).toBeUndefined();
    expect(result.packUnitId).toBeUndefined();
  });

  it("alias aprendido como empaque de 12 y la línea no lo contradice: empaque x12 confirmada", () => {
    const alias: MatchAlias = { aliasNorm: "leche completa caja 1l", productId: "p-leche", packLabel: "Bulto x12", unitsPerPack: 12, hits: 3 };
    const result = one({ ...lecheSinSku, quantity: 1, unitPrice: 480, lineTotal: 480 }, ctxWith([BULTO_LECHE], [alias]));

    expect(result).toMatchObject({ status: "confirmed", entryMode: "pack", packUnitId: "pu-lec-12", unitsPerPack: 12 });
  });
});
