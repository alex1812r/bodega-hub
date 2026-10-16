import type { InvoiceExtraction } from "../contracts";
import { loadMockMatchContext } from "./matchContext.mock-server";

const STORE_SUR = "00000000-0000-4000-8000-000000000002";

function extractionWith(rawText: string): InvoiceExtraction {
  return {
    supplier: { name: "Nadie Se Llama Así S.A." },
    currency: "VES",
    lines: [{ rawText, description: rawText, quantity: 1, unitPrice: 10, lineTotal: 10, confidence: 0.9 }],
    confidence: 0.9,
    warnings: [],
  };
}

describe("loadMockMatchContext · segunda pasada difusa (paridad SCN-11-it1)", () => {
  it("línea sin candidatos por el empaque en el texto: reintenta con el texto limpio y propone el producto", () => {
    const ctx = loadMockMatchContext(STORE_SUR, extractionWith("ARROZ BLANCO 1KG [BULTO X 24,00] |[DOC X 12.0]| (E)"));

    expect(ctx.fuzzy[0]?.[0]).toMatchObject({ productId: "prod-sur-arroz", via: "name" });
    expect(ctx.fuzzy[0]?.[0].score).toBe(1);
  });

  it("línea que ya trae candidatos en la primera pasada no se reintenta", () => {
    const ctx = loadMockMatchContext(STORE_SUR, extractionWith("ARROZ BLANCO 1KG"));

    expect(ctx.fuzzy[0]?.[0]).toMatchObject({ productId: "prod-sur-arroz", score: 1 });
  });

  it("sin nada parecido ni con el texto limpio: sin candidatos", () => {
    const ctx = loadMockMatchContext(STORE_SUR, extractionWith("ZZZ QQQ [BULTO X 24,00]"));

    expect(ctx.fuzzy[0]).toBeUndefined();
  });
});
