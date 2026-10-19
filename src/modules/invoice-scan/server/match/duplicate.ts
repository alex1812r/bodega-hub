import type { MatchPreviousScan } from "../match.types";

import { normalizeInvoiceNumber, sameTaxId, withinOneEdit } from "./text";

/** Tolerancia del total para el posible duplicado (caos 5.4). */
const DUPLICATE_TOTAL_TOLERANCE = 0.01 + 1e-9;

/**
 * Escaneo anterior del mismo proveedor (por `contactId` resuelto o por RIF,
 * `sameTaxId`) con el mismo número de factura normalizado. Si no lo hay,
 * posible duplicado (caos 5.4): mismo proveedor, mismo total (±0,01) y
 * - número que difiere en un solo carácter y misma fecha, o
 * - sin número leído y misma fecha (o sin fecha leída tampoco).
 * El escaneo de una compra anulada (`cancelado`) no cuenta: la factura no quedó
 * registrada (REP3-03a). La compra `devuelto` sí (D26).
 */
export function findDuplicateScan(input: {
  number: string | undefined;
  date?: string | undefined;
  total?: number | undefined;
  contactId: string | undefined;
  taxId: string | undefined;
  previousScans: MatchPreviousScan[];
}): string | undefined {
  const number = normalizeInvoiceNumber(input.number);
  const previousScans = input.previousScans.filter((scan) => scan.purchaseStatus !== "cancelado");
  const sameSupplier = (scan: MatchPreviousScan) =>
    (input.contactId !== undefined && scan.supplierId === input.contactId) || sameTaxId(input.taxId, scan.supplierTaxId);

  if (number) {
    const exact = preferConfirmed(
      previousScans.filter((scan) => normalizeInvoiceNumber(scan.number) === number && sameSupplier(scan)),
    );
    if (exact) {
      return exact.scanId;
    }
  }

  const total = input.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  const date = input.date?.trim() || undefined;
  if (!date && number) {
    return undefined;
  }

  const possible = preferConfirmed(previousScans.filter((scan) => {
    if (typeof scan.total !== "number" || Math.abs(scan.total - total) > DUPLICATE_TOTAL_TOLERANCE) {
      return false;
    }
    if (date && scan.date?.trim() !== date) {
      return false;
    }
    if (number && !withinOneEdit(number, normalizeInvoiceNumber(scan.number))) {
      return false;
    }
    return sameSupplier(scan);
  }));

  return possible?.scanId;
}

/**
 * SCN-UI-C2 (caos UI M2): de los escaneos que coinciden (del más reciente al más
 * antiguo), el confirmado con compra más reciente; si no hay, el más reciente. Un
 * escaneo abandonado en `extracted` no tapa la compra ya registrada.
 */
function preferConfirmed(scans: MatchPreviousScan[]): MatchPreviousScan | undefined {
  return scans.find((scan) => Boolean(scan.purchaseId)) ?? scans[0];
}
