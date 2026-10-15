/**
 * Contrato compartido del escaneo de facturas (plan factura-escaneo-gtm §4).
 *
 * Lo fija el gerente antes de la Ola 1 para que Extracción (SCN-01..03),
 * Emparejamiento (SCN-04..06), UI (SCN-07..09) y Evaluación (SCN-10..12)
 * partan del mismo shape. Cambiarlo exige avisar al gerente.
 */
import { z } from "zod";

export const invoiceLineUnits = [
  "unidad",
  "caja",
  "bulto",
  "paquete",
  "display",
  "otro",
] as const;

export const invoiceTaxHints = [
  "exento",
  "reducida",
  "general",
  "unknown",
] as const;

export const invoiceCurrencies = ["VES", "USD", "unknown"] as const;

const confidence = z.number().min(0).max(1);

export const invoiceExtractionLineSchema = z.object({
  /** Texto literal de la línea tal como aparece en la factura (obligatorio). */
  rawText: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.enum(invoiceLineUnits).optional(),
  unitsPerPack: z.number().int().positive().optional(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  taxHint: z.enum(invoiceTaxHints).optional(),
  barcode: z.string().optional(),
  /** Código del proveedor leído en la línea, si lo hay (cascada paso 1). */
  supplierSku: z.string().optional(),
  confidence,
});

export const invoiceExtractionSchema = z.object({
  supplier: z.object({
    name: z.string(),
    taxId: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),
  number: z.string().optional(),
  /** ISO `YYYY-MM-DD`. */
  date: z.string().optional(),
  currency: z.enum(invoiceCurrencies),
  /** Tasa Bs/USD impresa al pie, si la hay (caos 6.20). */
  printedRate: z.number().positive().optional(),
  lines: z.array(invoiceExtractionLineSchema),
  subtotal: z.number().optional(),
  tax: z.number().optional(),
  total: z.number().optional(),
  confidence,
  /** Avisos en español para el usuario. */
  warnings: z.array(z.string()),
});

export type InvoiceExtractionLine = z.infer<typeof invoiceExtractionLineSchema>;
export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

export const invoiceMatchStatuses = [
  "confirmed",
  "doubtful",
  "unmatched",
] as const;
export type InvoiceMatchStatus = (typeof invoiceMatchStatuses)[number];

export type InvoiceMatchCandidate = {
  productId: string;
  name: string;
  /** 0..1 */
  score: number;
  /** Motivo legible en español: "SKU del proveedor", "alias visto 4 veces", "nombre parecido 0,72". */
  reason: string;
};

export type InvoiceLineMatch = {
  /** Índice de la línea en `extraction.lines`. */
  index: number;
  status: InvoiceMatchStatus;
  productId?: string;
  candidates?: InvoiceMatchCandidate[];
  entryMode: "unit" | "pack";
  packUnitId?: string;
  /** Unidades por empaque resueltas (leídas o registradas). */
  unitsPerPack?: number;
  /** Producto con receta: desarmar al recibir. */
  disassembleOnReceive?: boolean;
  taxRateCode: string;
  unitCostVes?: number;
  unitCostRef?: number;
  /** Avisos en español: tamaño de empaque, coherencia de precio, moneda, etc. */
  issues: string[];
};

export type InvoiceMatch = {
  supplier: {
    contactId?: string;
    candidates?: { contactId: string; name: string; score: number; reason: string }[];
  };
  lines: InvoiceLineMatch[];
  totals: { read?: number; computed: number; mismatch: boolean };
  /** Tasa usada para convertir Bs → REF y la impresa si difiere > 3 %. */
  rate?: { system?: number; printed?: number; warning?: string };
  /** Mismo proveedor + número ya escaneado en la tienda (duplicado). */
  duplicateOfScanId?: string;
};

export type InvoiceScanLimits = {
  used: number;
  limit: number;
  remaining: number;
};

export type InvoiceScanResponse = {
  scanId: string;
  extraction: InvoiceExtraction;
  matched: InvoiceMatch;
  limits: InvoiceScanLimits;
  /** true si vino del caché por hash (0 llamadas al modelo). */
  cached: boolean;
};
