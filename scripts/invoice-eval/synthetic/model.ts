/**
 * Modelo del banco sintético (SCN-10e): tipos de las facturas, aritmética en
 * céntimos y formato venezolano. Plantillas y verdad salen de aquí, así que lo
 * impreso y lo que dice `truth/sNN.json` no pueden divergir.
 */
import type { InvoiceExtractionLine } from "../../../src/modules/invoice-scan/contracts";

export type TaxCode = "G" | "E";

export type SyntheticSupplier = {
  key: string;
  name: string;
  taxId: string;
  address: string;
  phone: string;
};

export type LineSpec = {
  /** Slug del producto unidad; null si la línea no es mercancía. */
  productKey: string | null;
  /** Texto literal impreso (nombre + marca de IVA + empaque). */
  rawText: string;
  description: string;
  quantity: number;
  unit?: InvoiceExtractionLine["unit"];
  unitsPerPack?: number;
  /** Bs por unidad impresa (por bulto/caja si la cantidad es por empaque). */
  unitPrice: number;
  /** Descuento por línea impreso, en %. */
  discountPct?: number;
  /** IVA para el cálculo de totales (se imprima o no la marca). */
  tax: TaxCode;
  supplierSku?: string;
  barcode?: string;
  note?: string;
};

export type InvoiceKind = "fiscal" | "thermal" | "handwritten" | "poster";
export type InvoiceEffect = "none" | "rotate" | "shadow" | "blur" | "dark";

export type InvoiceSpec = {
  id: string;
  supplierKey: string | null;
  kind: InvoiceKind;
  effect: InvoiceEffect;
  number?: string;
  controlNumber?: string;
  /** ISO `YYYY-MM-DD`. */
  date?: string;
  time?: string;
  printedRate?: number;
  globalDiscountPct?: number;
  /** Fiscal: imprime la columna CÓDIGO (SKU del proveedor). */
  showCodes?: boolean;
  /** Fiscal: imprime la columna DESC. %. */
  showDiscount?: boolean;
  /** Fiscal multipágina: cuántas líneas van en la página 1. */
  pageSplit?: number;
  /** Texto de observaciones al pie (no es línea). */
  footerNote?: string;
  lines: LineSpec[];
  /** Avisos que daría un lector perfecto (solo s08). */
  warnings?: string[];
  /** Qué ejercita el caso; va a verification.arithmetic. */
  caseNote: string;
};

export const IVA_GENERAL_PCT = 16;

export function toCents(bs: number): number {
  return Math.round(bs * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** 1234567.8 → "1.234.567,80" (Bs, coma decimal, punto de miles). */
export function formatBs(bs: number): string {
  const cents = toCents(bs);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100).toString();
  const dec = (abs % 100).toString().padStart(2, "0");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${dec}`;
}

/** "2026-09-02" → "02/09/2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** EAN-13 a partir de 12 dígitos (añade el dígito de control). */
export function ean13(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error(`EAN base inválida: ${base12}`);
  const sum = base12
    .split("")
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (sum % 10)) % 10}`;
}

export function lineTotalCents(line: LineSpec): number {
  const pct = line.discountPct ?? 0;
  return Math.round((line.quantity * toCents(line.unitPrice) * (100 - pct)) / 100);
}

export type InvoiceTotals = {
  lineTotals: number[];
  subtotal: number;
  sumG: number;
  sumE: number;
  discount: number;
  baseG: number;
  exento: number;
  iva: number;
  total: number;
};

/** Totales en céntimos. El descuento global se reparte G/E antes del IVA. */
export function computeTotals(spec: InvoiceSpec): InvoiceTotals {
  const lineTotals = spec.lines.map(lineTotalCents);
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const sumG = spec.lines.reduce((acc, line, i) => acc + (line.tax === "G" ? lineTotals[i] : 0), 0);
  const sumE = subtotal - sumG;
  const pct = spec.globalDiscountPct ?? 0;
  const discG = Math.round((sumG * pct) / 100);
  const discE = Math.round((sumE * pct) / 100);
  const baseG = sumG - discG;
  const exento = sumE - discE;
  const iva = Math.round((baseG * IVA_GENERAL_PCT) / 100);
  return {
    lineTotals,
    subtotal,
    sumG,
    sumE,
    discount: discG + discE,
    baseG,
    exento,
    iva,
    total: baseG + exento + iva,
  };
}

/** taxHint según lo impreso en el texto de la línea (regla de truth-format). */
export function printedTaxHint(rawText: string): InvoiceExtractionLine["taxHint"] {
  if (/\(E\)/.test(rawText)) return "exento";
  if (/\(G\)/.test(rawText)) return "general";
  return undefined;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
