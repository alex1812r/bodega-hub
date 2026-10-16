/**
 * Extracciones sintéticas (no salen de una factura real) con la forma de una
 * orden de despacho venezolana en Bs. Las usa el modelo mock y los tests.
 */
import type { InvoiceExtraction } from "../../contracts";

/** Factura de una página: cabecera, líneas con empaque y exento, tasa al pie. */
export const singlePageExtraction: InvoiceExtraction = {
  supplier: { name: "Distribuidora Sintética El Ávila", taxId: "J-123456789" },
  number: "00001234",
  date: "2026-10-12",
  currency: "VES",
  printedRate: 875.65,
  lines: [
    {
      rawText: "1 MALTA 1.5L [BULTO X 6] 4.203,12 4.203,12",
      description: "MALTA 1.5L",
      quantity: 1,
      unit: "bulto",
      unitsPerPack: 6,
      unitPrice: 4203.12,
      lineTotal: 4203.12,
      taxHint: "general",
      confidence: 0.95,
    },
    {
      rawText: "2 HARINA PAN 1KG [CAJA X 20] (E) 9.631,20 19.262,40",
      description: "HARINA PAN 1KG",
      quantity: 2,
      unit: "caja",
      unitsPerPack: 20,
      unitPrice: 9631.2,
      lineTotal: 19262.4,
      taxHint: "exento",
      confidence: 0.9,
    },
  ],
  subtotal: 23465.52,
  tax: 672.5,
  total: 24138.02,
  confidence: 0.9,
  warnings: [],
};

/** Primera página de una factura de dos: cabecera y líneas, sin totales. */
export const firstPageExtraction: InvoiceExtraction = {
  supplier: { name: "Distribuidora Sintética El Ávila", taxId: "J-123456789" },
  number: "00005678",
  date: "2026-10-13",
  currency: "VES",
  lines: [
    {
      rawText: "1 MALTA 1.5L [BULTO X 6] 4.203,12 4.203,12",
      description: "MALTA 1.5L",
      quantity: 1,
      unit: "bulto",
      unitsPerPack: 6,
      unitPrice: 4203.12,
      lineTotal: 4203.12,
      taxHint: "general",
      confidence: 0.95,
    },
  ],
  confidence: 0.92,
  warnings: ["Línea 3 parcialmente ilegible."],
};

/** Segunda página: sin cabecera (proveedor vacío), más líneas y los totales. */
export const secondPageExtraction: InvoiceExtraction = {
  supplier: { name: "" },
  currency: "unknown",
  printedRate: 880,
  lines: [
    {
      rawText: "3 ACEITE 1L (E) 1.500,00 4.500,00",
      description: "ACEITE 1L",
      quantity: 3,
      unit: "unidad",
      unitPrice: 1500,
      lineTotal: 4500,
      taxHint: "exento",
      confidence: 0.7,
    },
  ],
  subtotal: 8703.12,
  tax: 672.5,
  total: 9375.62,
  confidence: 0.7,
  warnings: ["Línea 3 parcialmente ilegible.", "El pie está borroso."],
};

/** Respuesta del modo "no es factura": sin líneas y con el aviso para el usuario. */
export const notAnInvoiceExtraction: InvoiceExtraction = {
  supplier: { name: "" },
  currency: "unknown",
  lines: [],
  confidence: 0,
  warnings: ["No parece una factura."],
};
