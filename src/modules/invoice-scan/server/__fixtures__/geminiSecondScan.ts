/**
 * Dos fotos de la MISMA factura leídas por Gemini (gemini-2.5-flash, QA final
 * SCN-UI, f02 y f03). Líneas tal cual las devolvió el modelo; proveedor, RIF y
 * número anonimizados. Entre fotos el modelo cambia el `rawText` (saltos de
 * línea en f02; "Bs <importe>" de más en f03) pero repite la `description`.
 */
import type { InvoiceExtraction, InvoiceExtractionLine } from "../../contracts";

export const SECOND_SCAN_RATE = 814.7;

type LineSeed = Pick<InvoiceExtractionLine, "description" | "quantity" | "unit" | "unitsPerPack" | "unitPrice" | "lineTotal">;

const seeds: LineSeed[] = [
  { description: "POWER MAX 400ML", quantity: 1, unit: "caja", unitsPerPack: 15, unitPrice: 4358.64, lineTotal: 4358.64 },
  { description: "GLUP COLA 2L", quantity: 1, unit: "bulto", unitsPerPack: 6, unitPrice: 5173.34, lineTotal: 5173.34 },
  { description: "COCA COLA 2L", quantity: 1, unit: "bulto", unitsPerPack: 6, unitPrice: 7226.39, lineTotal: 7226.39 },
  { description: "GLUP SABORES 2L", quantity: 2, unit: "bulto", unitsPerPack: 6, unitPrice: 4163.12, lineTotal: 8326.24 },
  { description: "JUSTY 400ML", quantity: 2, unit: "bulto", unitsPerPack: 15, unitPrice: 4032.77, lineTotal: 8065.54 },
];

/** rawText de f02 (con saltos de línea) y de f03 (en una línea, con "Bs <importe>"). */
const f02RawTexts = [
  "POWER MAX 400ML\n1,00 x 4.358,64\n[CAJA X 15,00]",
  "GLUP COLA 2L\n1,00 x 5.173,34\n[BULTO X 6,00]",
  "COCA COLA 2L\n1,00 x 7.226,39\n[BULTO X 6,00]",
  "GLUP SABORES 2L\n2,00 x 4.163,12\n[BULTO X 6,00]",
  "JUSTY 400ML\n2,00 x 4.032,77\n[BULTO X 15,00]",
];
const f03RawTexts = [
  "POWER MAX 400ML 1,00 x 4.358,64 Bs 4.358,64 [CAJA X 15,00]",
  "GLUP COLA 2L 1,00 x 5.173,34 Bs 5.173,34 [BULTO X 6,00]",
  "COCA COLA 2L 1,00 x 7.226,39 Bs 7.226,39 [BULTO X 6,00]",
  "GLUP SABORES 2L 2,00 x 4.163,12 Bs 8.326,24 [BULTO X 6,00]",
  "JUSTY 400ML 2,00 x 4.032,77 Bs 8.065,54 [BULTO X 15,00]",
];

function extraction(rawTexts: string[]): InvoiceExtraction {
  return {
    supplier: { name: "DISTRIBUIDORA ANONIMA, C.A", taxId: "J-000000019" },
    number: "00000001",
    currency: "VES",
    printedRate: SECOND_SCAN_RATE,
    lines: seeds.map((seed, index) => ({ ...seed, rawText: rawTexts[index], taxHint: "unknown", confidence: 1 })),
    subtotal: 33150.15,
    tax: 0,
    total: 33150.15,
    confidence: 0.9,
    warnings: [],
  };
}

export const geminiF02 = extraction(f02RawTexts);
export const geminiF03 = extraction(f03RawTexts);
