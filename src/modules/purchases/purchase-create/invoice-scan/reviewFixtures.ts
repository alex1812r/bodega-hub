/**
 * Fábrica de respuestas de escaneo para los tests de la revisión (SCN-08a).
 * Solo la importan tests y stories.
 */
import type {
  InvoiceExtraction,
  InvoiceExtractionLine,
  InvoiceLineMatch,
  InvoiceMatch,
  InvoiceScanResponse,
} from "@/modules/invoice-scan/contracts";

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
