import { buildContext, buildExtraction, buildLine, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import { INVALID_PRICE_ISSUE, NO_RATE_PRICE_ISSUE, USD_DOCUMENT_ISSUE } from "./match/money";
import type { InvoiceExtraction, InvoiceExtractionLine } from "../contracts";
import type { MatchContext } from "./match.types";

/** Catálogo de caos A1: alias "pepsi 2l" aprendido como CAJA x12, sin empaques registrados. */
function pepsiAliasContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return buildContext({
    supplierCatalogs: {
      [SUPPLIER_POLAR]: {
        supplierProducts: [],
        packUnits: [],
        aliases: [{ aliasNorm: "pepsi 2l", productId: "p-pepsi", packLabel: "CAJA", unitsPerPack: 12, hits: 5 }],
      },
    },
    ...overrides,
  });
}

/** Pepsi enlazada por SKU "X", sin alias ni empaques (caos M5). */
function pepsiSkuContext(): MatchContext {
  return buildContext({
    supplierCatalogs: {
      [SUPPLIER_POLAR]: {
        supplierProducts: [{ supplierProductId: "sp-p", productId: "p-pepsi", supplierSku: "X" }],
        aliases: [],
        packUnits: [],
      },
    },
  });
}

function one(
  line: Partial<InvoiceExtractionLine>,
  ctx: MatchContext = buildContext(),
  extraction: Partial<InvoiceExtraction> = {},
) {
  return matchInvoice(buildExtraction({ lines: [buildLine(line)], ...extraction }), ctx);
}

describe("matchInvoice · alias con tamaño de empaque (caos A1)", () => {
  const pepsi = { description: "PEPSI 2L", rawText: "PEPSI 2L", quantity: 12, unitPrice: 50, lineTotal: 600 };

  it("la línea dice 'unidad': modo unidad, nunca 12 cajas x12", () => {
    const line = one({ ...pepsi, unit: "unidad" }, pepsiAliasContext()).lines[0];

    expect(line.productId).toBe("p-pepsi");
    expect(line.entryMode).toBe("unit");
    expect(line.unitsPerPack).toBeUndefined();
  });

  it("'unidad' con precio de caja frente al último costo: dudosa '¿precio por caja o por unidad?'", () => {
    const ctx = pepsiAliasContext({
      products: buildContext().products.map((p) => (p.id === "p-pepsi" ? { ...p, lastUnitCostRef: 0.5 } : p)),
    });
    const line = one({ ...pepsi, quantity: 1, unitPrice: 600, lineTotal: 600, unit: "unidad" }, ctx).lines[0];

    expect(line.entryMode).toBe("unit");
    expect(line.status).toBe("doubtful");
    expect(line.issues.join(" ")).toContain("¿Precio por caja o por unidad?");
  });

  it("sin unit ni indicio de empaque en el texto: dudosa en modo unidad con aviso del alias", () => {
    const line = one(pepsi, pepsiAliasContext()).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.entryMode).toBe("unit");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.issues).toEqual([
      "La línea no dice que sea un empaque y el alias aprendido es de 12 unidades por empaque: confirma si son unidades o empaques.",
    ]);
  });

  it("con indicio de empaque (unit caja): aplica el tamaño del alias", () => {
    const line = one({ ...pepsi, unit: "caja", quantity: 1 }, pepsiAliasContext()).lines[0];

    expect(line).toMatchObject({ status: "confirmed", entryMode: "pack", unitsPerPack: 12, issues: [] });
  });

  it("tamaño leído distinto del alias: dudosa con aviso de tamaño, sin fijar unitsPerPack", () => {
    const line = one({ ...pepsi, unit: "caja", unitsPerPack: 6, quantity: 1 }, pepsiAliasContext()).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.issues).toEqual([
      "La factura dice caja de 6 unidades y el alias aprendido es de 12: confirma las unidades por empaque.",
    ]);
  });

  it("tamaño del alias (la factura no lo dice) distinto del registrado: el aviso habla del alias, no de la factura (SCN-06-F3)", () => {
    const ctx = pepsiAliasContext({
      supplierCatalogs: {
        [SUPPLIER_POLAR]: {
          supplierProducts: [],
          packUnits: [{ id: "pu-pepsi-6", productId: "p-pepsi", label: "Caja x6", unitsPerPack: 6 }],
          aliases: [{ aliasNorm: "pepsi 2l", productId: "p-pepsi", packLabel: "CAJA", unitsPerPack: 12, hits: 5 }],
        },
      },
    });
    const line = one({ ...pepsi, unit: "caja", quantity: 1 }, ctx).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.issues).toEqual([
      "El alias aprendido es de caja de 12 unidades y el empaque registrado es de 6: confirma las unidades por empaque.",
    ]);
  });
});

describe("matchInvoice · alias exacto hacia un producto que ya no está (SCN-06-F3)", () => {
  it("el primer alias apunta a un producto ausente: se usa el siguiente alias exacto", () => {
    const ctx = buildContext({
      supplierCatalogs: {
        [SUPPLIER_POLAR]: {
          supplierProducts: [],
          packUnits: [],
          aliases: [
            { aliasNorm: "pepsi vieja", productId: "p-borrado", packLabel: null, unitsPerPack: null, hits: 9 },
            { aliasNorm: "pepsi 2l", productId: "p-pepsi", packLabel: null, unitsPerPack: null, hits: 2 },
          ],
        },
      },
    });
    const line = one({ description: "PEPSI VIEJA", rawText: "PEPSI 2L", unit: "unidad" }, ctx).lines[0];

    expect(line.productId).toBe("p-pepsi");
    expect(line.status).toBe("confirmed");
    expect(line.candidates?.[0]).toMatchObject({ productId: "p-pepsi", reason: "alias visto 2 veces" });
  });
});

describe("matchInvoice · variantes de dólar con currency unknown (caos M4, 6.21)", () => {
  it.each([
    "MALTA POLAR 355 ML 12 5USD 60USD",
    "MALTA POLAR 355 ML USD5.00",
    "MALTA POLAR 355 ML US$5",
    "MALTA POLAR 355 ML 5 DOLARES",
    "MALTA POLAR 355 ML 5 DÓLARES",
    "MALTA POLAR 355 ML 5 dólares",
    "MALTA POLAR 355 ML 5 DLS",
    "MALTA POLAR 355 ML ＄5",
    "MALTA POLAR 355 ML 5$",
  ])("%s: dudosa con anomalía y sin costos en Bs", (rawText) => {
    const line = one({ rawText }, buildContext(), { currency: "unknown" }).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain(USD_DOCUMENT_ISSUE);
    expect(line.unitCostVes).toBeUndefined();
  });

  it("la marca en la description también cuenta", () => {
    const line = one({ description: "MALTA POLAR 355 ML 5 USD", rawText: "MALTA" }, buildContext(), {
      currency: "unknown",
    }).lines[0];

    expect(line.issues).toContain(USD_DOCUMENT_ISSUE);
  });

  it.each(["MALTA POLAR 355 ML HANDLS", "GALLETA ODLSA 12", "QUESO DOLARESCO", "JUSDO 1KG"])(
    "'%s' no es dólar (DLS/USD/DOLAR dentro de otra palabra)",
    (rawText) => {
      const line = one({ rawText }, buildContext(), { currency: "unknown" }).lines[0];

      expect(line.issues).not.toContain(USD_DOCUMENT_ISSUE);
    },
  );
});

describe("matchInvoice · empaque fuera del enum o solo en el texto (caos M5, 6.19)", () => {
  it("unit 'otro' (FARDO) sin número: dudosa pidiendo unidades por empaque", () => {
    const line = one(
      { description: "PEPSI 2L FARDO", supplierSku: "X", unit: "otro", quantity: 1, unitPrice: 300, lineTotal: 300 },
      pepsiSkuContext(),
    ).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.entryMode).toBe("pack");
    expect(line.unitsPerPack).toBeUndefined();
    expect(line.issues).toEqual(["La factura no dice cuántas unidades trae cada empaque: indícalo."]);
  });

  it.each(["1 BULTO PEPSI 2L 300,00", "1 CAJA PEPSI 2L", "FARDO PEPSI 2L", "PAQ PEPSI 2L", "1 DISPLAY PEPSI", "1 DOC PEPSI 2L", "BLISTER PEPSI"])(
    "sin unit y rawText '%s': dudosa pidiendo unidades, nunca 1 unidad confirmada",
    (rawText) => {
      const line = one(
        { description: "PEPSI 2L", rawText, supplierSku: "X", quantity: 1, unitPrice: 300, lineTotal: 300 },
        pepsiSkuContext(),
      ).lines[0];

      expect(line.status).toBe("doubtful");
      expect(line.entryMode).toBe("pack");
      expect(line.issues[0]).toContain("cuántas unidades trae cada empaque");
    },
  );

  // Caos A-n1: la palabra del texto ya no confirma por sí sola el empaque único.
  it("sin unit, 'CAJA' solo en el texto y un solo empaque registrado: dudosa con ese empaque propuesto", () => {
    const line = one({ description: "2 CAJA MALTA POLAR", rawText: "2 CAJA MALTA POLAR", supplierSku: "MAL-355", quantity: 2, unitPrice: 300, lineTotal: 600 }).lines[0];

    expect(line).toMatchObject({ status: "doubtful", entryMode: "pack", packUnitId: "pu-malta-6", unitsPerPack: 6 });
  });

  it("sin unit, 'CAJA' en el texto y alias aprendido en modo unidad: modo unidad (manda el alias)", () => {
    const line = one({ rawText: "2 CAJA MALTA POLAR 355 ML", quantity: 2, unitPrice: 300, lineTotal: 600 }).lines[0];

    expect(line).toMatchObject({ entryMode: "unit" });
    expect(line.packUnitId).toBeUndefined();
  });
});

describe("matchInvoice · bordes bajos (caos B1, B2, B4, cantidad)", () => {
  it("description y rawText casan con alias de productos distintos: dudosa con ambos candidatos", () => {
    const line = one({ description: "HARINA PAN 1KG", rawText: "MALTA POLAR 355 ML" }).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates?.map((c) => c.productId).sort()).toEqual(["p-harina", "p-malta"]);
  });

  it("valores gigantes: precio inválido, sin 'Infinity' y totales finitos", () => {
    const result = one({ quantity: 1e308, unitPrice: 1e308, lineTotal: 0 });
    const line = result.lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain(INVALID_PRICE_ISSUE);
    expect(line.issues.join(" ")).not.toMatch(/Infinity|undefined|NaN/);
    expect(Number.isFinite(result.totals.computed)).toBe(true);
  });

  it("lineTotal 1e308: precio inválido y computed finito", () => {
    const result = one({ lineTotal: 1e308 }, buildContext(), { total: 1e308 });

    expect(result.lines[0].issues).toContain(INVALID_PRICE_ISSUE);
    expect(Number.isFinite(result.totals.computed)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("null");
  });

  it("sin ninguna tasa y con último costo que comprobar: dudosa 'sin tasa no se verificó el precio'", () => {
    const line = one(
      { unit: "caja", unitsPerPack: 6, quantity: 1, unitPrice: 180000, lineTotal: 180000 },
      buildContext({ systemRate: undefined }),
    ).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain(NO_RATE_PRICE_ISSUE);
  });

  it("sin ninguna tasa y sin último costo: no hay coherencia que comprobar, no avisa", () => {
    const line = one(
      { description: "PEPSI 2L", supplierSku: "X", quantity: 1, unitPrice: 300, lineTotal: 300 },
      { ...pepsiSkuContext(), systemRate: undefined },
    ).lines[0];

    expect(line.issues).not.toContain(NO_RATE_PRICE_ISSUE);
  });

  it("cantidad con decimales: dudosa (la compra exige enteros)", () => {
    const line = one({ quantity: 1.5, unitPrice: 50, lineTotal: 75 }).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues.join(" ")).toContain("Cantidad con decimales");
  });
});
