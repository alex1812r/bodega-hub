/**
 * REP9-01 (D41-a/D42, QA p9 M-p9-1): el último costo unitario REF viaja con CADA candidato
 * (`candidates[].lastUnitCostRef`), no solo con el producto propuesto, para que la revisión
 * compare la opción elegida con el último costo de ESE producto al cambiar de candidato.
 */
import { invoiceMatchSchema } from "./invoiceMatchSchema";
import { buildContext, buildExtraction, buildLine } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";

/** Como el mock m04: «MALTA 1.5L [BULTO X 6]» con dos candidatos de nombre parecido y un tercero sin costo. */
function maltaLine() {
  return buildExtraction({
    lines: [
      buildLine({
        description: "MALTA 1.5L",
        rawText: "1 MALTA 1.5L [BULTO X 6] 4.203,12 4.203,12",
        unit: "bulto",
        unitsPerPack: 6,
        quantity: 1,
        unitPrice: 4203.12,
        lineTotal: 4203.12,
      }),
    ],
  });
}

describe("REP9-01 · lastUnitCostRef en cada candidato", () => {
  it("cada candidato trae el último costo unitario de SU producto; sin costo conocido, sin campo", () => {
    const result = matchInvoice(
      maltaLine(),
      buildContext({
        fuzzy: {
          0: [
            { productId: "p-malta", score: 0.75, via: "name" },
            { productId: "p-refresco", score: 0.65, via: "name" },
            { productId: "p-pepsi", score: 0.6, via: "name" },
          ],
        },
      }),
    );

    const [line] = result.lines;
    expect(line.productId).toBeUndefined();
    expect(line.candidates).toEqual([
      expect.objectContaining({ productId: "p-malta", lastUnitCostRef: 0.5 }),
      expect.objectContaining({ productId: "p-refresco", lastUnitCostRef: 3 }),
      expect.objectContaining({ productId: "p-pepsi" }),
    ]);
    expect(line.candidates?.[2]).not.toHaveProperty("lastUnitCostRef");
  });

  it("un candidato con receta reparte su costo por empaque entre sus unidades (mismo criterio que la línea)", () => {
    const result = matchInvoice(
      maltaLine(),
      buildContext({
        fuzzy: {
          0: [
            { productId: "p-caja-malta", score: 0.7, via: "name" },
            { productId: "p-malta", score: 0.65, via: "name" },
          ],
        },
      }),
    );

    const [line] = result.lines;
    expect(line.candidates?.map((candidate) => [candidate.productId, candidate.lastUnitCostRef])).toEqual([
      ["p-caja-malta", 0.5],
      ["p-malta", 0.5],
    ]);
    expect(line.lastUnitCostRef).toBe(0.5);
  });

  it("línea confirmada por alias: su candidato también lo trae", () => {
    const result = matchInvoice(buildExtraction(), buildContext());

    const [line] = result.lines;
    expect(line.productId).toBe("p-malta");
    expect(line.candidates).toEqual([expect.objectContaining({ productId: "p-malta", lastUnitCostRef: 0.5 })]);
  });

  it("el esquema del caché valida el campo del candidato (positivo)", () => {
    const matched = matchInvoice(buildExtraction(), buildContext());
    const withCost = (lastUnitCostRef: number) => ({
      ...matched,
      lines: matched.lines.map((line) => ({
        ...line,
        candidates: line.candidates?.map((candidate) => ({ ...candidate, lastUnitCostRef })),
      })),
    });

    expect(invoiceMatchSchema.safeParse(withCost(0.5)).success).toBe(true);
    expect(invoiceMatchSchema.safeParse(withCost(-1)).success).toBe(false);
  });
});
