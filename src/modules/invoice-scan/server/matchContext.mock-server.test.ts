import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";
import { singlePageExtraction } from "./__fixtures__/extractions";
import { resetMockInvoiceScans } from "./confirmScan.mock-server";
import { matchInvoice } from "./match";
import { loadMockMatchContext } from "./matchContext.mock-server";
import { putMockScanRow, seedScanForTest } from "./scans.mock-server";

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

describe("loadMockMatchContext · posible duplicado (paridad SCN-11-F4)", () => {
  const scanCtx = { storeId: DEFAULT_STORE_ID, userId: "user-1" };
  const seed = (sha: string, extracted: InvoiceExtraction) =>
    seedScanForTest(scanCtx, {
      extracted,
      imageSha256: sha.repeat(64),
      model: "mock",
      provider: "mock",
      storagePath: `${DEFAULT_STORE_ID}/${sha.repeat(64)}/p1.jpg`,
    });

  beforeEach(() => resetMockInvoiceScans());

  it("sin número: trae el escaneo del mismo total y fecha (con fecha y total) y matchInvoice lo marca", async () => {
    const previous = await seed("c", singlePageExtraction);
    await seed("d", { ...singlePageExtraction, total: 999 });
    const scanned: InvoiceExtraction = { ...singlePageExtraction, number: undefined };

    const ctx = loadMockMatchContext(DEFAULT_STORE_ID, scanned);

    expect(ctx.previousScans).toEqual([
      expect.objectContaining({ scanId: previous.id, date: "2026-10-12", total: 24138.02 }),
    ]);
    expect(matchInvoice(scanned, ctx).duplicateOfScanId).toBe(previous.id);
  });

  it("número con un dígito mal leído y misma fecha/total: posible duplicado", async () => {
    const previous = await seed("e", singlePageExtraction);
    const scanned: InvoiceExtraction = { ...singlePageExtraction, number: "00001239" };

    const ctx = loadMockMatchContext(DEFAULT_STORE_ID, scanned);

    expect(matchInvoice(scanned, ctx).duplicateOfScanId).toBe(previous.id);
  });
});

describe("loadMockMatchContext · duplicado prefiere el escaneo confirmado (paridad SCN-UI-C2)", () => {
  const scanCtx = { storeId: DEFAULT_STORE_ID, userId: "user-1" };
  const seed = (sha: string, createdAt: string, purchaseId: string | null) =>
    seedScanForTest(scanCtx, {
      extracted: singlePageExtraction,
      imageSha256: sha.repeat(64),
      model: "mock",
      provider: "mock",
      storagePath: `${DEFAULT_STORE_ID}/${sha.repeat(64)}/p1.jpg`,
    }).then((row) =>
      putMockScanRow({ ...row, createdAt, purchaseId, status: purchaseId ? "confirmed" : "extracted" }),
    );

  beforeEach(() => resetMockInvoiceScans());

  it("el aviso apunta al confirmado con compra aunque haya un abandonado más reciente", async () => {
    const confirmed = await seed("a", "2026-10-01T10:00:00.000Z", "purchase-1");
    await seed("b", "2026-10-02T10:00:00.000Z", null);

    const ctx = loadMockMatchContext(DEFAULT_STORE_ID, singlePageExtraction);

    expect(matchInvoice(singlePageExtraction, ctx).duplicateOfScanId).toBe(confirmed.id);
  });
});
