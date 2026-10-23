import { buildContext, buildExtraction, buildLine, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";

function matchOne(line = buildLine(), ctxOverrides: Parameters<typeof buildContext>[0] = {}) {
  const result = matchInvoice(buildExtraction({ lines: [line] }), buildContext(ctxOverrides));
  return result.lines[0];
}

describe("matchInvoice · cascada de producto", () => {
  it("confirma por alias exacto normalizado del proveedor resuelto", () => {
    const line = matchOne(buildLine({ description: "Malta  Polár 355-ML" }));

    expect(line.status).toBe("confirmed");
    expect(line.productId).toBe("p-malta");
    expect(line.candidates).toEqual([
      { productId: "p-malta", name: "Malta Polar 355 ml", score: 1, reason: "alias visto 4 veces", lastUnitCostRef: 0.5 },
    ]);
    expect(line.issues).toEqual([]);
  });

  it("dice 'alias visto 1 vez' en singular", () => {
    const line = matchOne(buildLine({ description: "HARINA PAN 1KG", quantity: 10, unitPrice: 120, lineTotal: 1200 }));

    expect(line.status).toBe("confirmed");
    expect(line.candidates?.[0].reason).toBe("alias visto 1 vez");
  });

  it("confirma por SKU del proveedor (normalizado) antes que por alias", () => {
    const line = matchOne(
      buildLine({ description: "COLA 2 LITROS", supplierSku: "ref-2l", quantity: 6, unitPrice: 300, lineTotal: 1800 }),
    );

    expect(line.status).toBe("confirmed");
    expect(line.productId).toBe("p-refresco");
    expect(line.candidates?.[0].reason).toBe("SKU del proveedor");
  });

  it("dos productos con el mismo SKU del proveedor: dudosa con ambos", () => {
    const ctx = buildContext();
    ctx.supplierCatalogs[SUPPLIER_POLAR].supplierProducts.push({
      supplierProductId: "sp-dup",
      productId: "p-pepsi",
      supplierSku: "MAL-355",
    });
    const result = matchInvoice(
      buildExtraction({ lines: [buildLine({ description: "X", supplierSku: "MAL-355" })] }),
      ctx,
    );

    expect(result.lines[0].status).toBe("doubtful");
    expect(result.lines[0].productId).toBeUndefined();
    expect(result.lines[0].candidates?.map((c) => c.productId)).toEqual(["p-malta", "p-pepsi"]);
  });

  it("alias difuso (>= 0,6) queda dudoso con candidato y motivo con coma decimal", () => {
    const line = matchOne(buildLine({ description: "MALTA POL 355" }), {
      fuzzy: { 0: [{ productId: "p-malta", score: 0.72, via: "alias" }] },
    });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates).toEqual([
      {
        productId: "p-malta",
        name: "Malta Polar 355 ml",
        score: 0.72,
        reason: "alias parecido 0,72 · vinculado al proveedor",
        lastUnitCostRef: 0.5,
      },
    ]);
  });

  it("descarta alias difuso < 0,6 y nombres de productos inactivos", () => {
    const line = matchOne(buildLine({ description: "GALLETA MARIA" }), {
      fuzzy: {
        0: [
          { productId: "p-malta", score: 0.55, via: "alias" },
          { productId: "p-galleta", score: 0.9, via: "name" },
        ],
      },
    });

    expect(line.status).toBe("unmatched");
    expect(line.candidates).toBeUndefined();
  });

  it("código de barras único en línea por unidad: confirma con el candidato (D17; casos en match.d17.test.ts)", () => {
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: "7591001000011" }));

    expect(line.status).toBe("confirmed");
    expect(line.productId).toBe("p-malta");
    expect(line.candidates?.[0]).toMatchObject({ productId: "p-malta", reason: "código de barras" });
  });

  it("candidato con score 0,99 sin alias sigue dudoso (6.16)", () => {
    const line = matchOne(buildLine({ description: "ACEITE VATEL 1L", quantity: 1, unitPrice: 250, lineTotal: 250 }), {
      fuzzy: { 0: [{ productId: "p-aceite", score: 0.99, via: "name" }] },
    });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates?.[0].reason).toBe("nombre parecido 0,99 · vinculado al proveedor");
  });

  it("dos candidatos empatados: dudosa con ambos, no elige", () => {
    const line = matchOne(buildLine({ description: "BEBIDA 2L" }), {
      fuzzy: {
        0: [
          { productId: "p-pepsi", score: 0.7, via: "name" },
          { productId: "p-malta", score: 0.6, via: "name" },
        ],
      },
    });

    // p-malta está vinculado (+0,1) y empata con p-pepsi: ambos, orden estable por nombre.
    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates?.map((c) => c.productId)).toEqual(["p-malta", "p-pepsi"]);
  });

  it("mismo nombre en dos categorías: dudosa con los dos candidatos (6.9)", () => {
    const ctx = buildContext({
      fuzzy: {
        0: [
          { productId: "p-arroz-a", score: 0.95, via: "name" },
          { productId: "p-arroz-b", score: 0.95, via: "name" },
        ],
      },
    });
    ctx.supplierCatalogs[SUPPLIER_POLAR].supplierProducts = ctx.supplierCatalogs[SUPPLIER_POLAR].supplierProducts.filter(
      (link) => link.productId !== "p-arroz-b",
    );
    const result = matchInvoice(buildExtraction({ lines: [buildLine({ description: "ARROZ MARY 1KG" })] }), ctx);
    const line = result.lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates?.map((c) => c.productId).sort()).toEqual(["p-arroz-a", "p-arroz-b"]);
  });

  it("los vinculados al proveedor van primero y se limita a 3 candidatos", () => {
    const line = matchOne(buildLine({ description: "ALGO" }), {
      fuzzy: {
        0: [
          { productId: "p-pepsi", score: 0.8, via: "name" },
          { productId: "p-arroz-a", score: 0.75, via: "name" },
          { productId: "p-arroz-b", score: 0.72, via: "name" },
          { productId: "p-harina", score: 0.71, via: "name" },
        ],
      },
    });

    // p-arroz-b (0,72 + 0,1) y p-harina (0,71 + 0,1) están vinculados a Polar.
    expect(line.candidates?.map((c) => c.productId)).toEqual(["p-arroz-b", "p-harina", "p-pepsi"]);
  });

  it("sin nada: unmatched", () => {
    const line = matchOne(buildLine({ description: "COSA DESCONOCIDA" }));

    expect(line.status).toBe("unmatched");
    expect(line.productId).toBeUndefined();
  });

  it("sin proveedor resuelto no hay confirmadas aunque el alias exista", () => {
    const result = matchInvoice(
      buildExtraction({ supplier: { name: "Comercial Desconocida" }, lines: [buildLine()] }),
      buildContext(),
    );

    expect(result.supplier.contactId).toBeUndefined();
    expect(result.lines[0].status).not.toBe("confirmed");
  });

  it.each([
    ["alias", buildLine({ description: "GALLETA MARIA" })],
    ["SKU", buildLine({ description: "GALLETAS SURTIDAS", supplierSku: "GAL-9" })],
  ])("%s exacto hacia un producto inactivo: dudosa con aviso y conserva el candidato", (_via, input) => {
    const ctx = buildContext();
    ctx.supplierCatalogs[SUPPLIER_POLAR].aliases.push({
      aliasNorm: "galleta maria",
      productId: "p-galleta",
      packLabel: null,
      unitsPerPack: null,
      hits: 3,
    });
    ctx.supplierCatalogs[SUPPLIER_POLAR].supplierProducts.push({
      supplierProductId: "sp-galleta",
      productId: "p-galleta",
      supplierSku: "GAL-9",
    });
    const line = matchInvoice(buildExtraction({ lines: [input] }), ctx).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-galleta");
    expect(line.candidates?.map((c) => c.productId)).toEqual(["p-galleta"]);
    expect(line.issues).toContain("El producto está inactivo: actívalo o elige otro.");
  });
});
