/**
 * SCN-08a · Salida de la revisión: líneas del formulario y bloque del escaneo
 * para `POST /api/purchases` (D10).
 */
jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { draftToPurchaseItemInput } from "@bodega/core/purchases";

import { invoiceExtractionSchema } from "@/modules/invoice-scan/contracts";
import { normalizeExtractionForMatch } from "@/modules/invoice-scan/server/matchScan";
import { createPurchaseSchema } from "@/modules/purchases/schemas/createPurchase.schema";
import { roundMoney } from "@/shared/utils/currency";

import { buildInvoiceReviewDraft, buildCorrectedExtraction, taxHintFromCode, type InvoiceReviewDraft } from "./reviewDraft";
import {
  REVIEW_SCAN_ID,
  REVIEW_SUPPLIER_ID,
  REVIEW_TAX_RATES,
  doubtfulLine,
  makeReviewResponse,
  productUuid,
  unmatchedLine,
  type ReviewFixtureLine,
} from "./reviewFixtures";
import { createInvoiceReviewState, reviewReducer, type InvoiceReviewContext } from "./reviewModel";

const PURCHASE_KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

/** El body real de `POST /api/purchases` (SCN-08a-F1: antes era una copia parcial). */
const purchaseBodySchema = createPurchaseSchema;

const ctx: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

function stateOf(
  lines: ReviewFixtureLine[],
  extra: Omit<Parameters<typeof makeReviewResponse>[0], "lines"> = {},
  context: InvoiceReviewContext = ctx,
) {
  return createInvoiceReviewState(makeReviewResponse({ lines, ...extra }), context);
}

/** Body completo como lo arma la página: cabecera de la compra + bloque del escaneo + líneas. */
function bodyOf(draft: InvoiceReviewDraft) {
  const items = draft.lines.map((line) => ({
    ...draftToPurchaseItemInput(line.item, draft.rateVes ?? 0),
    taxRateCode: line.taxRateCode,
    ...(line.disassembleOnReceive ? { disassembleOnReceive: true } : {}),
  }));
  const sum = (key: "subtotalRef" | "subtotalVes" | "taxRef" | "taxVes") =>
    roundMoney(items.reduce((total, item) => total + item[key], 0));

  return {
    clientRequestId: PURCHASE_KEY,
    discountRef: 0,
    discountVes: 0,
    ...(draft.purchaseNumber ? { purchaseNumber: draft.purchaseNumber } : {}),
    refRateVes: draft.rateVes,
    status: "recibido",
    subtotalRef: sum("subtotalRef"),
    subtotalVes: sum("subtotalVes"),
    supplierId: draft.supplier.contactId,
    taxRef: sum("taxRef"),
    taxVes: sum("taxVes"),
    ...draft.body,
    items,
  };
}

describe("buildInvoiceReviewDraft", () => {
  it("null mientras no se pueda cargar", () => {
    expect(buildInvoiceReviewDraft(stateOf([doubtfulLine(1)]))).toBeNull();
  });

  it("salida pasa invoiceExtractionSchema y el schema del body de compra", () => {
    let state = stateOf(
      [
        {},
        doubtfulLine(2, 0.9, {
          read: { rawText: "MALTA CAJA X12", unit: "caja", unitsPerPack: 12, quantity: 2, unitPrice: 1200, lineTotal: 2400 },
          match: { entryMode: "pack", issues: ["empaque registrado de 6"] },
        }),
        unmatchedLine(3, false, { read: { rawText: "FLETE", quantity: 1, unitPrice: 50, lineTotal: 50 } }),
      ],
      { extraction: { total: 2600 } },
    );
    state = reviewReducer(state, { type: "acceptMarked", index: 1 });
    state = reviewReducer(state, { type: "editUnitsPerPack", index: 1, unitsPerPack: 12 });
    state = reviewReducer(state, { type: "discardLine", index: 2 });
    state = reviewReducer(state, { type: "editQuantity", index: 0, quantity: 3 });
    state = reviewReducer(state, { type: "editTaxRate", index: 0, taxRateCode: "exento" });
    state = reviewReducer(state, { type: "editHeader", number: "  000124 ", date: "2026-10-13" });

    const draft = buildInvoiceReviewDraft(state);
    expect(draft).not.toBeNull();
    if (!draft) return;

    expect(draft).toMatchObject({
      supplier: { contactId: REVIEW_SUPPLIER_ID },
      purchaseNumber: "000124",
      date: "2026-10-13",
      costCurrency: "ves",
      rateVes: 900,
    });
    expect(draft.lines.map((line) => [line.lineIndex, line.lock])).toEqual([
      [0, true],
      [1, true],
    ]);
    expect(draft.lines[0].item).toMatchObject({
      entryMode: "unit",
      id: `invoice-scan-${REVIEW_SCAN_ID}-0`,
      quantity: 3,
      unitCostVes: 100,
      taxRate: 0,
      costCurrency: "ves",
    });
    expect(draft.lines[1].item).toMatchObject({
      entryMode: "pack",
      packCount: 2,
      packCostVes: 1200,
      unitsPerPack: 12,
      packLabel: "Caja",
      quantity: 24,
      unitCostVes: 100,
      taxRate: 16,
    });
    expect(draft.body.invoiceScanId).toBe(REVIEW_SCAN_ID);
    expect(draft.body.invoiceScanLines).toEqual([
      { lineIndex: 0, productId: productUuid(1) },
      { lineIndex: 1, productId: productUuid(2), packLabel: "Caja", unitsPerPack: 12 },
    ]);

    const extraction = invoiceExtractionSchema.parse(draft.body.invoiceScanExtraction);
    expect(extraction.lines).toHaveLength(3);
    expect(extraction).toMatchObject({ number: "000124", date: "2026-10-13" });
    expect(extraction.lines[0]).toMatchObject({ quantity: 3, taxHint: "exento", lineTotal: 200 });
    expect(extraction.lines[1]).toMatchObject({ unitsPerPack: 12, taxHint: "general" });

    const parsed = purchaseBodySchema.safeParse(bodyOf(draft));
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it("tasa impresa elegida: costos como REF convertidos con la impresa", () => {
    let state = stateOf([{ read: { quantity: 1, unitPrice: 9000, lineTotal: 9000 } }], {
      extraction: { printedRate: 875.65 },
    });
    expect(buildInvoiceReviewDraft(state)?.lines[0].item).toMatchObject({ costCurrency: "ves", unitCostVes: 9000 });

    state = reviewReducer(state, { type: "setRateChoice", choice: "printed" });
    const draft = buildInvoiceReviewDraft(state);
    expect(draft?.costCurrency).toBe("ref");
    expect(draft?.rateVes).toBe(900);
    expect(draft?.invoiceRateVes).toBe(875.65);
    expect(draft?.lines[0].item).toMatchObject({ costCurrency: "ref", unitCostRef: 10.28 });
  });

  it("sin tasa del sistema, la impresa: REF convertidos y espejo con la impresa", () => {
    const state = stateOf([{ read: { quantity: 1, unitPrice: 8756.5, lineTotal: 8756.5 } }], {
      extraction: { printedRate: 875.65 },
    }, { taxRates: REVIEW_TAX_RATES });
    const draft = buildInvoiceReviewDraft(state);

    expect(draft).toMatchObject({ costCurrency: "ref", rateVes: 875.65 });
    expect(draft?.lines[0].item).toMatchObject({ unitCostRef: 10, unitCostVes: 8756.5 });
  });

  it("USD aceptado: costos REF = precio de la factura; la extracción sigue en USD", () => {
    let state = stateOf([{ read: { quantity: 2, unitPrice: 3.5, lineTotal: 7 } }], { extraction: { currency: "USD" } });
    state = reviewReducer(state, { type: "acceptMarked", index: 0 });
    expect(buildInvoiceReviewDraft(state)).toBeNull();

    state = reviewReducer(state, { type: "acceptUsdAnomaly" });
    const draft = buildInvoiceReviewDraft(state);
    expect(draft?.costCurrency).toBe("ref");
    expect(draft?.invoiceRateVes).toBeUndefined();
    expect(draft?.lines[0].item).toMatchObject({ costCurrency: "ref", unitCostRef: 3.5, quantity: 2 });
    expect(draft?.body.invoiceScanExtraction.currency).toBe("USD");
    expect(draft && purchaseBodySchema.safeParse(bodyOf(draft)).success).toBe(true);
  });

  it("desarmar al recibir y nextId propio", () => {
    const state = stateOf([
      { match: { entryMode: "pack", unitsPerPack: 24, packUnitId: "pu-24", disassembleOnReceive: true } },
    ]);
    const draft = buildInvoiceReviewDraft(state, { nextId: (index) => `id-${index}` });

    expect(draft?.lines[0]).toMatchObject({ disassembleOnReceive: true, item: { id: "id-0", packUnitId: "pu-24" } });
  });
});

describe("buildCorrectedExtraction", () => {
  it("quita el número vacío y el tamaño de una línea pasada a unidad", () => {
    let state = stateOf([{ read: { unit: "caja", unitsPerPack: 12 }, match: { entryMode: "pack", unitsPerPack: 12 } }]);
    state = reviewReducer(state, { type: "editEntryMode", index: 0, entryMode: "unit" });
    state = reviewReducer(state, { type: "editHeader", number: "  " });
    const extraction = buildCorrectedExtraction(state);

    expect(extraction.number).toBeUndefined();
    expect(extraction.lines[0].unitsPerPack).toBeUndefined();
    expect(invoiceExtractionSchema.safeParse(extraction).success).toBe(true);
  });

  it('textos opcionales "" o solo espacios en cabecera y líneas: el body pasa el schema real y el borde del servidor los quita', () => {
    const state = stateOf([{ read: { barcode: "", supplierSku: "  " } }, { read: { barcode: " ", supplierSku: "" } }], {
      extraction: { number: "", supplier: { address: " ", name: "Chevere Depot", phone: "", taxId: "  " } },
    });
    const draft = buildInvoiceReviewDraft(state);
    expect(draft).not.toBeNull();
    if (!draft) return;

    expect("number" in draft.body.invoiceScanExtraction).toBe(false);
    const parsed = purchaseBodySchema.safeParse(bodyOf(draft));
    expect(parsed.error?.issues).toBeUndefined();

    // Lo que se guarda en confirmed.extraction (route.ts, SCN-13a-F1).
    const confirmed = normalizeExtractionForMatch(parsed.data?.invoiceScanExtraction ?? draft.body.invoiceScanExtraction);
    expect(confirmed.supplier).toEqual({ name: "Chevere Depot" });
    expect(confirmed.lines.every((line) => !("barcode" in line) && !("supplierSku" in line))).toBe(true);
    expect(confirmed.lines.map((line) => line.quantity)).toEqual([2, 2]);
  });

  it("taxHint desde el código o el porcentaje", () => {
    expect(taxHintFromCode("general", {})).toBe("general");
    expect(taxHintFromCode("otro-0", { "otro-0": 0 })).toBe("exento");
    expect(taxHintFromCode("otro-12", { "otro-12": 12 })).toBe("unknown");
  });
});
