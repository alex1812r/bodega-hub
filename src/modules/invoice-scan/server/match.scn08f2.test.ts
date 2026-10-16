import { buildContext, buildExtraction, buildLine, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import type { MatchContext } from "./match.types";
import type { InvoiceExtractionLine } from "../contracts";

/** Catálogo de Polar con un empaque registrado de Harina (Caja x12). */
function withHarinaPack(overrides: Partial<MatchContext> = {}): MatchContext {
  const base = buildContext();
  const polar = base.supplierCatalogs[SUPPLIER_POLAR];
  return buildContext({
    supplierCatalogs: {
      [SUPPLIER_POLAR]: {
        ...polar,
        packUnits: [...polar.packUnits, { id: "pu-harina-12", productId: "p-harina", label: "Caja x12", unitsPerPack: 12 }],
      },
    },
    ...overrides,
  });
}

function matchOne(overrides: Partial<InvoiceExtractionLine>, ctx: MatchContext = buildContext()) {
  return matchInvoice(buildExtraction({ lines: [buildLine(overrides)] }), ctx).lines[0];
}

// Alias aprendido "harina pan 1kg bulto" -> p-harina, BULTO/20. Último costo 1,2 REF a 100 Bs/REF.
const SECOND_SCAN = { description: "HARINA PAN 1KG BULTO", unit: "bulto", unitsPerPack: 20, quantity: 1 } as const;

describe("matchInvoice · SCN-08-F2 (segundo escaneo y empaques del candidato)", () => {
  it("tamaño leído = tamaño del alias aprendido, sin empaque registrado: confirmada en modo empaque", () => {
    const line = matchOne({ ...SECOND_SCAN, unitPrice: 2400, lineTotal: 2400 });

    expect(line).toMatchObject({ status: "confirmed", productId: "p-harina", entryMode: "pack", unitsPerPack: 20, issues: [] });
  });

  it("tamaño leído = tamaño del alias aunque el registrado sea otro: confirmada con el tamaño del alias", () => {
    const line = matchOne({ ...SECOND_SCAN, unitPrice: 2400, lineTotal: 2400 }, withHarinaPack());

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", unitsPerPack: 20, issues: [] });
    expect(line.packUnitId).toBeUndefined();
  });

  it("tamaño leído = alias = empaque registrado: confirmada con packUnitId", () => {
    const ctx = withHarinaPack();
    ctx.supplierCatalogs[SUPPLIER_POLAR].packUnits.push({ id: "pu-harina-20", productId: "p-harina", label: "Bulto", unitsPerPack: 20 });
    const line = matchOne({ ...SECOND_SCAN, unitPrice: 2400, lineTotal: 2400 }, ctx);

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", packUnitId: "pu-harina-20", unitsPerPack: 20, issues: [] });
  });

  it("tamaño del alias pero precio incoherente (40 %): sigue dudosa por precio", () => {
    const line = matchOne({ ...SECOND_SCAN, unitPrice: 120, lineTotal: 120 });

    expect(line.status).toBe("doubtful");
    expect(line.unitsPerPack).toBe(20);
    expect(line.issues).toHaveLength(1);
    expect(line.issues[0]).not.toContain("empaque registrado");
  });

  it("candidato solo por nombre: el aviso de empaque mira los empaques registrados del candidato (M2)", () => {
    const ctx = withHarinaPack({ fuzzy: { 0: [{ productId: "p-harina", score: 0.72, via: "name" }] } });
    const line = matchOne({ description: "HARINA P.A.N. MAIZ BLANCO", unit: "caja", unitsPerPack: 20, quantity: 1, unitPrice: 2400, lineTotal: 2400 }, ctx);

    expect(line.productId).toBeUndefined();
    expect(line.candidates?.[0]?.productId).toBe("p-harina");
    expect(line.status).not.toBe("confirmed");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.issues).toContain(
      "La factura dice caja de 20 unidades y el empaque registrado es de 12: confirma las unidades por empaque.",
    );
    expect(line.issues.join(" ")).not.toContain("No hay empaque registrado");
  });
});
