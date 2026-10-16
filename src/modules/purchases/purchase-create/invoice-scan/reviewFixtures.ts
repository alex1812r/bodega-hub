/**
 * Fábrica de respuestas de escaneo para los tests de la revisión (SCN-08a).
 * Solo la importan tests y stories.
 */
import { createPackDraftItem, createUnitDraftItem } from "@bodega/core/purchases";

import type {
  InvoiceExtraction,
  InvoiceExtractionLine,
  InvoiceLineMatch,
  InvoiceMatch,
  InvoiceScanResponse,
} from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewDraft } from "./reviewDraft";

export const REVIEW_SCAN_ID = "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
export const REVIEW_SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
export const REVIEW_TAX_RATES = { exento: 0, general: 16, reducida: 8 };

/** UUID v4 válido distinto por número (para `invoiceScanLineInputSchema`). */
export function productUuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

export type ReviewFixtureLine = {
  read?: Partial<InvoiceExtractionLine>;
  match?: Partial<InvoiceLineMatch>;
};

export function makeReadLine(overrides: Partial<InvoiceExtractionLine> = {}): InvoiceExtractionLine {
  return {
    rawText: "HARINA PAN 1KG",
    description: "Harina PAN 1kg",
    quantity: 2,
    unitPrice: 100,
    lineTotal: 200,
    confidence: 0.9,
    ...overrides,
  };
}

export function makeReviewResponse(input: {
  lines: ReviewFixtureLine[];
  extraction?: Partial<InvoiceExtraction>;
  matched?: Partial<InvoiceMatch>;
}): InvoiceScanResponse {
  const readLines = input.lines.map((line) => makeReadLine(line.read));
  const extraction: InvoiceExtraction = {
    supplier: { name: "Chevere Depot", taxId: "J-12345678-9" },
    number: "000123",
    date: "2026-10-14",
    currency: "VES",
    lines: readLines,
    confidence: 0.9,
    warnings: [],
    ...input.extraction,
  };
  const matchLines = input.lines.map(
    (line, index): InvoiceLineMatch => ({
      index,
      status: "confirmed",
      productId: productUuid(index + 1),
      entryMode: "unit",
      taxRateCode: "general",
      issues: [],
      ...line.match,
    }),
  );
  return {
    scanId: REVIEW_SCAN_ID,
    extraction,
    matched: {
      supplier: { contactId: REVIEW_SUPPLIER_ID },
      lines: matchLines,
      totals: { computed: 0, mismatch: false },
      ...input.matched,
    },
    limits: { used: 1, limit: 30, remaining: 29 },
    cached: false,
  };
}

/** Línea dudosa con un candidato (el propuesto). */
export function doubtfulLine(seed: number, score = 0.72, extra: ReviewFixtureLine = {}): ReviewFixtureLine {
  return {
    read: extra.read,
    match: {
      status: "doubtful",
      productId: productUuid(seed),
      candidates: [
        { productId: productUuid(seed), name: `Producto ${seed}`, score, reason: `nombre parecido ${score}` },
        { productId: productUuid(seed + 100), name: `Otro ${seed}`, score: 0.5, reason: "nombre parecido 0,50" },
      ],
      ...extra.match,
    },
  };
}

/** Línea sin emparejar con candidatos difusos (o sin ninguno). */
export function unmatchedLine(seed: number, withCandidates = true, extra: ReviewFixtureLine = {}): ReviewFixtureLine {
  return {
    read: extra.read,
    match: {
      status: "unmatched",
      productId: undefined,
      candidates: withCandidates
        ? [{ productId: productUuid(seed), name: `Producto ${seed}`, score: 0.41, reason: "nombre parecido 0,41" }]
        : undefined,
      ...extra.match,
    },
  };
}

/**
 * Salida de una revisión lista para cargar (SCN-08c): factura en Bs convertida a REF con
 * la tasa impresa (500) mientras el sistema tiene 510. Tres líneas leídas: la 0 por
 * unidad (2 × REF 10), la 1 descartada y la 2 una caja de 12 a desarmar (REF 24).
 */
export function makeLoadedReviewDraft(overrides: Partial<InvoiceReviewDraft> = {}): InvoiceReviewDraft {
  const extraction: InvoiceExtraction = {
    supplier: { name: "Chevere Depot", taxId: "J-12345678-9" },
    number: "000123",
    date: "2026-10-14",
    currency: "VES",
    printedRate: 500,
    lines: [
      makeReadLine({ quantity: 2, unitPrice: 5000, lineTotal: 10000, taxHint: "general" }),
      makeReadLine({ rawText: "BOLSA", description: "Bolsa", quantity: 1, unitPrice: 10, lineTotal: 10 }),
      makeReadLine({
        rawText: "REFRESCO COLA CJ12",
        description: "Refresco Cola caja 12",
        quantity: 1,
        unit: "caja",
        unitsPerPack: 12,
        unitPrice: 12000,
        lineTotal: 12000,
        taxHint: "exento",
      }),
    ],
    confidence: 0.9,
    warnings: [],
  };

  return {
    supplier: { contactId: REVIEW_SUPPLIER_ID, name: "Chevere Depot" },
    purchaseNumber: "000123",
    date: "2026-10-14",
    costCurrency: "ref",
    rateVes: 510,
    invoiceRateVes: 500,
    lines: [
      {
        lineIndex: 0,
        lock: true,
        productId: productUuid(1),
        productName: "Harina PAN",
        taxRateCode: "general",
        item: createUnitDraftItem({
          costCurrency: "ref",
          id: `invoice-scan-${REVIEW_SCAN_ID}-0`,
          productId: productUuid(1),
          quantity: 2,
          rateVes: 510,
          taxRate: 16,
          unitCostRef: 10,
        }),
      },
      {
        lineIndex: 2,
        lock: true,
        productId: productUuid(3),
        productName: "Refresco Cola",
        taxRateCode: "exento",
        disassembleOnReceive: true,
        item: createPackDraftItem({
          costCurrency: "ref",
          id: `invoice-scan-${REVIEW_SCAN_ID}-2`,
          packCostRef: 24,
          packCount: 1,
          packLabel: "Caja",
          productId: productUuid(3),
          rateVes: 510,
          taxRate: 0,
          unitsPerPack: 12,
        }),
      },
    ],
    body: {
      invoiceScanId: REVIEW_SCAN_ID,
      invoiceScanLines: [
        { lineIndex: 0, productId: productUuid(1) },
        { lineIndex: 2, productId: productUuid(3), packLabel: "Caja", unitsPerPack: 12 },
      ],
      invoiceScanExtraction: extraction,
    },
    ...overrides,
  };
}
