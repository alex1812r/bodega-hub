import { buildContext, buildExtraction, buildLine } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import type { InvoiceExtractionLine } from "../contracts";

function matchOne(overrides: Partial<InvoiceExtractionLine>) {
  return matchInvoice(buildExtraction({ lines: [buildLine(overrides)] }), buildContext()).lines[0];
}

describe("matchInvoice · empaques", () => {
  it("tamaño leído = empaque registrado: modo empaque con packUnitId, confirmada", () => {
    // Refresco: por SKU y sin alias aprendido en modo unidad (malta lo tiene: caos A-r3-1).
    const line = matchOne({ description: "COLA 2L", supplierSku: "REF 2L", unit: "paquete", unitsPerPack: 6, quantity: 2, unitPrice: 1800, lineTotal: 3600 });

    expect(line).toMatchObject({
      status: "confirmed",
      productId: "p-refresco",
      entryMode: "pack",
      packUnitId: "pu-refresco-6",
      unitsPerPack: 6,
      issues: [],
    });
  });

  it("PAQUETE x12 para empaque registrado de 6: dudosa con aviso de tamaño y sin convertir (6.8)", () => {
    const line = matchOne({ description: "COLA 2L", supplierSku: "REF 2L", unit: "paquete", unitsPerPack: 12, quantity: 2, unitPrice: 3600, lineTotal: 7200 });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-refresco");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.packUnitId).toBeUndefined();
    expect(line.issues).toEqual([
      "La factura dice paquete de 12 unidades y el empaque registrado es de 6: confirma las unidades por empaque.",
    ]);
  });

  it("'paquete' sin número y un solo empaque registrado: usa ese", () => {
    const line = matchOne({ description: "COLA 2L", supplierSku: "REF 2L", unit: "paquete", quantity: 2, unitPrice: 1800, lineTotal: 3600 });

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", packUnitId: "pu-refresco-6", unitsPerPack: 6 });
  });

  it("'caja' declarada para un producto cuyo alias del proveedor es de modo unidad: dudosa con contradicción (caos A-r3-1)", () => {
    const line = matchOne({ unit: "caja", quantity: 2, unitPrice: 300, lineTotal: 600 });

    expect(line).toMatchObject({ status: "doubtful", entryMode: "pack", packUnitId: "pu-malta-6", unitsPerPack: 6 });
    expect(line.issues[0]).toContain("Antes este proveedor lo facturó por unidad; ahora dice caja");
  });

  it("'bulto' sin número y sin empaque registrado: dudosa pidiendo unidades, nunca 1 unidad (6.19)", () => {
    const line = matchOne({ description: "HARINA PAN 1KG", unit: "bulto", quantity: 1, unitPrice: 2400, lineTotal: 2400 });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-harina");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    // "harina pan 1kg" ya se aprendió en modo unidad con este proveedor (caos A-r3-1).
    expect(line.issues).toEqual([
      "Antes este proveedor lo facturó por unidad; ahora dice bulto: confirma si son empaques o unidades sueltas.",
      "La factura no dice cuántas unidades trae cada bulto: indícalo.",
    ]);
  });

  it("'caja' sin número con varios empaques registrados: dudosa", () => {
    const line = matchOne({ description: "ACEITE", supplierSku: "ACE-1", unit: "caja", quantity: 1, unitPrice: 3000, lineTotal: 3000 });

    expect(line.status).toBe("doubtful");
    expect(line.entryMode).toBe("pack");
    expect(line.packUnitId).toBeUndefined();
    expect(line.issues[0]).toContain("cuántas unidades trae cada caja");
  });

  it("tamaño leído sin empaque registrado: dudosa con el leído como sugerencia", () => {
    const line = matchOne({ description: "HARINA PAN 1KG", unit: "bulto", unitsPerPack: 20, quantity: 1, unitPrice: 2400, lineTotal: 2400 });

    expect(line.status).toBe("doubtful");
    expect(line.unitsPerPack).toBe(20);
    expect(line.issues).toEqual([
      "Antes este proveedor lo facturó por unidad; ahora dice bulto: confirma si son empaques o unidades sueltas.",
      "No hay empaque registrado de 20 unidades para este proveedor: confirma las unidades por empaque.",
    ]);
  });

  it("el alias con unitsPerPack resuelve el empaque la segunda vez", () => {
    const line = matchOne({ description: "HARINA PAN 1KG BULTO", unit: "bulto", quantity: 1, unitPrice: 2400, lineTotal: 2400 });

    expect(line).toMatchObject({ status: "confirmed", productId: "p-harina", entryMode: "pack", unitsPerPack: 20, issues: [] });
  });

  it("CAJA x6 con total de una unidad: dudosa '¿precio por caja o por unidad?' aunque el empaque coincida (6.18)", () => {
    const line = matchOne({
      description: "COLA 2L",
      supplierSku: "REF 2L",
      unit: "caja",
      unitsPerPack: 6,
      quantity: 1,
      unitPrice: 300,
      lineTotal: 300,
    });

    expect(line.packUnitId).toBe("pu-refresco-6");
    expect(line.status).toBe("doubtful");
    expect(line.issues).toEqual([
      "¿Precio por caja o por unidad? Sale a 0,50 REF por unidad y el último costo fue 3,00 REF.",
    ]);
  });

  it("CAJA x6 con precio coherente con el último costo: confirmada", () => {
    const line = matchOne({
      description: "COLA 2L",
      supplierSku: "REF 2L",
      unit: "caja",
      unitsPerPack: 6,
      quantity: 1,
      unitPrice: 1800,
      lineTotal: 1800,
    });

    expect(line.status).toBe("confirmed");
    expect(line.unitCostVes).toBe(1800);
    expect(line.unitCostRef).toBe(18);
  });

  it("producto con receta: modo empaque con la conversión registrada y desarmar al recibir (caos M-r3-1)", () => {
    const line = matchOne({ description: "CAJA MALTA X36", supplierSku: "CMX36", quantity: 2, unitPrice: 1800, lineTotal: 3600 });

    // create_purchase exige units_per_pack = product_pack_conversions.total_units (36), nunca 1.
    expect(line).toMatchObject({
      status: "confirmed",
      productId: "p-caja-malta",
      entryMode: "pack",
      unitsPerPack: 36,
      disassembleOnReceive: true,
      issues: [],
    });
  });

  it.each<[string, Partial<InvoiceExtractionLine>]>([
    ["unit caja sin tamaño", { unit: "caja" }],
    ["unit caja con el tamaño de la receta", { unit: "caja", unitsPerPack: 36 }],
    // "unit unidad" ya no confirma: ¿empaques o unidades sueltas? (caos B-r4-1, match.caos-r4.test.ts).
  ])("receta con %s: confirmada con la conversión registrada (caos B-r3-4)", (_name, extra) => {
    const line = matchOne({ description: "CAJA MALTA X36", supplierSku: "CMX36", quantity: 2, unitPrice: 1800, lineTotal: 3600, ...extra });

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", unitsPerPack: 36, disassembleOnReceive: true, issues: [] });
  });

  it("receta con tamaño leído distinto de la conversión: dudosa con aviso, propone la conversión", () => {
    const line = matchOne({ description: "CAJA MALTA X36", supplierSku: "CMX36", unit: "caja", unitsPerPack: 24, quantity: 2, unitPrice: 1800, lineTotal: 3600 });

    expect(line).toMatchObject({ status: "doubtful", entryMode: "pack", unitsPerPack: 36, disassembleOnReceive: true });
    expect(line.issues).toEqual([
      "La factura dice caja de 24 unidades y la receta del producto es de 36: confirma las unidades por empaque.",
    ]);
  });

  it("receta sin conversión conocida en el contexto: dudosa pidiendo unidades, nunca upp 1", () => {
    const ctx = buildContext();
    ctx.products = ctx.products.map((p) => (p.id === "p-caja-malta" ? { ...p, recipeUnitsPerPack: undefined } : p));
    const extraction = buildExtraction({
      lines: [buildLine({ description: "CAJA MALTA X36", supplierSku: "CMX36", quantity: 2, unitPrice: 1800, lineTotal: 3600 })],
    });
    const line = matchInvoice(extraction, ctx).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.disassembleOnReceive).toBe(true);
  });

  it("línea en unidades sin empaque: modo unidad", () => {
    const line = matchOne({});

    expect(line.entryMode).toBe("unit");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.disassembleOnReceive).toBeUndefined();
  });
});
