import { buildContext, buildExtraction, buildLine, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice, INACTIVE_PRODUCT_ISSUE } from "./match";
import { USD_DOCUMENT_ISSUE } from "./match/money";
import type { MatchContext } from "./match.types";
import type { InvoiceExtraction, InvoiceExtractionLine } from "../contracts";

/**
 * D17 (SCN-11-it2): SKU del proveedor exacto (paso 1) o código de barras exacto
 * (paso 3) CONFIRMA cuando la línea es por unidad o su empaque coincide con uno
 * registrado (empaque del proveedor o receta del mismo tamaño). Empaque
 * declarado sin registrar -> dudosa con el producto y el aviso de tamaño.
 */
function matchOne(
  line: InvoiceExtractionLine,
  ctx: MatchContext = buildContext(),
  extraction: Partial<InvoiceExtraction> = {},
) {
  return matchInvoice(buildExtraction({ ...extraction, lines: [line] }), ctx).lines[0];
}

/** Harina con SKU del proveedor y solo el alias "bulto x20" (sin empaque registrado). */
function harinaCtx(): MatchContext {
  const ctx = buildContext();
  const catalog = ctx.supplierCatalogs[SUPPLIER_POLAR];
  catalog.supplierProducts = catalog.supplierProducts.map((link) =>
    link.productId === "p-harina" ? { ...link, supplierSku: "HP-1" } : link,
  );
  catalog.aliases = catalog.aliases.filter((alias) => alias.aliasNorm !== "harina pan 1kg");
  return ctx;
}

describe("matchInvoice · D17 SKU del proveedor", () => {
  it("línea por unidad confirma", () => {
    const line = matchOne(buildLine({ description: "MALTITA", supplierSku: "MAL-355", unit: "unidad", unitsPerPack: 1 }));

    expect(line).toMatchObject({ status: "confirmed", productId: "p-malta", entryMode: "unit", issues: [] });
  });

  it("empaque igual al registrado del proveedor confirma con su packUnitId", () => {
    const line = matchOne(
      buildLine({ description: "ACEITE", supplierSku: "ACE-1", unit: "caja", unitsPerPack: 12, quantity: 1, unitPrice: 3000, lineTotal: 3000 }),
    );

    expect(line).toMatchObject({ status: "confirmed", productId: "p-aceite", entryMode: "pack", packUnitId: "pu-aceite-12", issues: [] });
  });

  it("producto con receta del mismo tamaño confirma", () => {
    const line = matchOne(
      buildLine({ description: "CAJA MALTA", supplierSku: "CMX36", unit: "caja", unitsPerPack: 36, quantity: 1, unitPrice: 1800, lineTotal: 1800 }),
    );

    expect(line).toMatchObject({ status: "confirmed", productId: "p-caja-malta", entryMode: "pack", unitsPerPack: 36 });
  });

  it("empaque declarado sin registrar: dudosa con el producto y el aviso de tamaño", () => {
    const line = matchOne(
      buildLine({ description: "MALTITA", supplierSku: "MAL-355", unit: "caja", unitsPerPack: 12, quantity: 1, unitPrice: 600, lineTotal: 600 }),
    );

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-malta");
    expect(line.issues.join(" ")).toContain("12 unidades");
  });

  it("empaque solo aprendido por otro alias del producto, sin registrar: dudosa", () => {
    const line = matchOne(
      buildLine({ description: "HARINA PAN BULTO", supplierSku: "HP-1", unit: "bulto", quantity: 1, unitPrice: 2400, lineTotal: 2400 }),
      harinaCtx(),
    );

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-harina");
    expect(line.unitsPerPack).toBe(20);
    expect(line.issues.join(" ")).toContain("No hay empaque registrado de 20 unidades");
  });

  it("precio incoherente (> 40 %): dudosa", () => {
    const line = matchOne(buildLine({ description: "MALTITA", supplierSku: "MAL-355", quantity: 12, unitPrice: 150, lineTotal: 1800 }));

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-malta");
  });
});

describe("matchInvoice · D17 código de barras", () => {
  const MALTA_BARCODE = "7591001000011";

  it("línea por unidad confirma", () => {
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE }));

    expect(line).toMatchObject({ status: "confirmed", productId: "p-malta", entryMode: "unit", issues: [] });
    expect(line.candidates?.[0]).toMatchObject({ productId: "p-malta", reason: "código de barras" });
  });

  it("empaque igual al registrado del proveedor confirma", () => {
    const line = matchOne(
      buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE, unit: "caja", unitsPerPack: 6, quantity: 2, unitPrice: 300, lineTotal: 600 }),
    );

    expect(line).toMatchObject({ status: "confirmed", productId: "p-malta", entryMode: "pack", packUnitId: "pu-malta-6" });
  });

  it("empaque declarado sin registrar: dudosa con el producto y el aviso de tamaño", () => {
    const line = matchOne(
      buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE, unit: "caja", unitsPerPack: 12, quantity: 1, unitPrice: 600, lineTotal: 600 }),
    );

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-malta");
    expect(line.issues.join(" ")).toContain("12 unidades");
  });

  it("barcode de dos productos: dudosa sin elegir", () => {
    const ctx = buildContext();
    ctx.products = ctx.products.map((product) =>
      product.id === "p-pepsi" ? { ...product, barcode: MALTA_BARCODE } : product,
    );
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE }), ctx);

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBeUndefined();
    expect(line.candidates?.map((c) => c.productId).sort()).toEqual(["p-malta", "p-pepsi"]);
  });

  it("precio incoherente (> 40 %): dudosa", () => {
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE, unitPrice: 150, lineTotal: 1800 }));

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-malta");
  });

  it("moneda USD: dudosa", () => {
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE }), buildContext(), {
      currency: "USD",
    });

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain(USD_DOCUMENT_ISSUE);
  });

  it("producto inactivo: no confirma", () => {
    const ctx = buildContext();
    ctx.products = ctx.products.map((product) =>
      product.id === "p-galleta" ? { ...product, barcode: "7590000000001" } : product,
    );
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: "7590000000001" }), ctx);

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain(INACTIVE_PRODUCT_ISSUE);
  });

  it("sin proveedor resuelto no confirma", () => {
    const line = matchOne(buildLine({ description: "PRODUCTO RARO", barcode: MALTA_BARCODE }), buildContext(), {
      supplier: { name: "Comercial Desconocida" },
    });

    expect(line.status).toBe("doubtful");
    expect(line.productId).toBe("p-malta");
  });
});
