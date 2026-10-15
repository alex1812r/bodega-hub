import { buildContext, buildExtraction, buildLine } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import type { InvoiceExtractionLine } from "../contracts";

function matchOne(overrides: Partial<InvoiceExtractionLine>) {
  return matchInvoice(buildExtraction({ lines: [buildLine(overrides)] }), buildContext()).lines[0];
}

describe("matchInvoice · empaques", () => {
  it("tamaño leído = empaque registrado: modo empaque con packUnitId, confirmada", () => {
    const line = matchOne({ unit: "caja", unitsPerPack: 6, quantity: 2, unitPrice: 300, lineTotal: 600 });

    expect(line).toMatchObject({
      status: "confirmed",
      productId: "p-malta",
      entryMode: "pack",
      packUnitId: "pu-malta-6",
      unitsPerPack: 6,
      issues: [],
    });
  });

  it("CAJA x12 para empaque registrado de 6: dudosa con aviso de tamaño y sin convertir (6.8)", () => {
    const line = matchOne({ unit: "caja", unitsPerPack: 12, quantity: 2, unitPrice: 600, lineTotal: 1200 });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-malta");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.packUnitId).toBeUndefined();
    expect(line.issues).toEqual([
      "La factura dice caja de 12 unidades y el empaque registrado es de 6: confirma las unidades por empaque.",
    ]);
  });

  it("'caja' sin número y un solo empaque registrado: usa ese", () => {
    const line = matchOne({ unit: "caja", quantity: 2, unitPrice: 300, lineTotal: 600 });

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", packUnitId: "pu-malta-6", unitsPerPack: 6 });
  });

  it("'bulto' sin número y sin empaque registrado: dudosa pidiendo unidades, nunca 1 unidad (6.19)", () => {
    const line = matchOne({ description: "HARINA PAN 1KG", unit: "bulto", quantity: 1, unitPrice: 2400, lineTotal: 2400 });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-harina");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.issues).toEqual(["La factura no dice cuántas unidades trae cada bulto: indícalo."]);
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

  it("producto con receta: modo empaque y desarmar al recibir", () => {
    const line = matchOne({ description: "CAJA MALTA X36", supplierSku: "CMX36", quantity: 2, unitPrice: 1800, lineTotal: 3600 });

    expect(line).toMatchObject({
      status: "confirmed",
      productId: "p-caja-malta",
      entryMode: "pack",
      unitsPerPack: 1,
      disassembleOnReceive: true,
    });
  });

  it("línea en unidades sin empaque: modo unidad", () => {
    const line = matchOne({});

    expect(line.entryMode).toBe("unit");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.disassembleOnReceive).toBeUndefined();
  });
});
