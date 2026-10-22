/**
 * REP8-01 (D38, QA p8 M-p8-1): el emparejamiento devuelve SIEMPRE el último costo unitario
 * conocido del producto propuesto (`lastUnitCostRef`), haya o no aviso de precio, para que la
 * revisión compare cada opción «Por unidad / Por empaque» con él.
 */
import type { MatchContext, MatchProduct } from "./match.types";
import { buildContext, buildExtraction, buildLine, products, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";

const GLUP: MatchProduct = {
  id: "p-glup",
  name: "Refresco Glup Sabor 2 L",
  sku: "GLU-002",
  barcode: null,
  active: true,
  taxRateCode: "general",
  lastUnitCostRef: 0.59,
  hasRecipe: false,
};

/** Catálogo de Polar con Harina a 1,04 REF/u y Glup aprendidos «por unidad» (alias sin empaque), como Mercaseu en QA p8. */
function qa8Context(): MatchContext {
  const base = buildContext();
  const polar = base.supplierCatalogs[SUPPLIER_POLAR];
  return {
    ...base,
    products: [...products.map((p) => (p.id === "p-harina" ? { ...p, lastUnitCostRef: 1.04 } : p)), GLUP],
    supplierCatalogs: {
      [SUPPLIER_POLAR]: {
        ...polar,
        supplierProducts: [
          ...polar.supplierProducts,
          { supplierProductId: "sp-glup", productId: GLUP.id, supplierSku: null },
        ],
        aliases: [
          ...polar.aliases,
          { aliasNorm: "refresco glup sabor 2lt", productId: GLUP.id, packLabel: null, unitsPerPack: null, hits: 1 },
        ],
      },
    },
  };
}

describe("REP8-01 · lastUnitCostRef en cada línea con último costo conocido", () => {
  it("Harina «BULTO X 20» coherente por empaque (20 × 1,04): sin aviso de precio y con último 1,04", () => {
    const result = matchInvoice(
      buildExtraction({
        lines: [
          buildLine({
            description: "HARINA PAN 1KG",
            rawText: "HARINA PAN 1KG (E) [BULTO X 20.0]",
            unit: "bulto",
            unitsPerPack: 20,
            quantity: 1,
            unitPrice: 2080,
            lineTotal: 2080,
          }),
        ],
      }),
      qa8Context(),
    );

    const [line] = result.lines;
    expect(line).toMatchObject({ productId: "p-harina", entryMode: "pack", unitsPerPack: 20, lastUnitCostRef: 1.04 });
    expect(line.issues.some((issue) => issue.startsWith("¿Precio por"))).toBe(false);
  });

  it("Glup «CAJA X 8» coherente (8 × 0,59): último 0,59", () => {
    const result = matchInvoice(
      buildExtraction({
        lines: [
          buildLine({
            description: "REFRESCO GLUP SABOR 2LT",
            rawText: "REFRESCO GLUP SABOR 2LT [CAJA X 8.0]",
            unit: "caja",
            unitsPerPack: 8,
            quantity: 1,
            unitPrice: 472,
            lineTotal: 472,
          }),
        ],
      }),
      qa8Context(),
    );

    expect(result.lines[0]).toMatchObject({ productId: GLUP.id, entryMode: "pack", lastUnitCostRef: 0.59 });
  });

  it("confirmada por unidad y sin aviso: también trae el último costo", () => {
    const result = matchInvoice(buildExtraction(), buildContext());

    expect(result.lines[0]).toMatchObject({ status: "confirmed", productId: "p-malta", lastUnitCostRef: 0.5 });
  });

  it("producto con receta: el último costo es del empaque y sale por unidad de stock (18 ÷ 36)", () => {
    const result = matchInvoice(
      buildExtraction({
        lines: [buildLine({ description: "CAJA MALTA X36", supplierSku: "CMX36", quantity: 1, unitPrice: 1800, lineTotal: 1800 })],
      }),
      buildContext(),
    );

    expect(result.lines[0]).toMatchObject({ productId: "p-caja-malta", unitsPerPack: 36, lastUnitCostRef: 0.5 });
  });

  it("sin último costo conocido: no trae el campo", () => {
    const result = matchInvoice(
      buildExtraction(),
      buildContext({ products: products.map((p) => (p.id === "p-malta" ? { ...p, lastUnitCostRef: null } : p)) }),
    );

    expect(result.lines[0]).not.toHaveProperty("lastUnitCostRef");
  });
});
