import type { MatchPreviousScan } from "../match.types";

import { normalizeInvoiceNumber, sameTaxId, withinOneEdit } from "./text";

/** Tolerancia del total para el posible duplicado (caos 5.4). */
const DUPLICATE_TOTAL_TOLERANCE = 0.01 + 1e-9;

export type DuplicateScanInput = {
  number: string | undefined;
  date?: string | undefined;
  total?: number | undefined;
  /** Contacto leído (resuelto al emparejar) del escaneo actual. */
  contactId: string | undefined;
  /** REP12-01 (D52): proveedor elegido en la revisión, si difiere del leído. */
  supplierId?: string | undefined;
  /** RIF leído del escaneo actual. */
  taxId: string | undefined;
  previousScans: MatchPreviousScan[];
};

/**
 * Escaneos anteriores que serían la misma factura (REP12-01, D53: la única regla, la usan el
 * emparejamiento y `POST /api/purchases/invoice-scan/duplicates`). Mismo proveedor si casa
 * cualquiera de los del actual (elegido o contacto leído) con cualquiera del previo (elegido al
 * confirmar o contacto leído), o el RIF leído (`sameTaxId`). Con el mismo número de factura
 * normalizado; si no hay ninguno, posible duplicado (caos 5.4): mismo proveedor, mismo total
 * (±0,01) y
 * - número que difiere en un solo carácter y misma fecha, o
 * - sin número leído y misma fecha (o sin fecha leída tampoco).
 * El escaneo de una compra anulada (`cancelado`) no cuenta: la factura no quedó registrada
 * (REP3-03a). La compra `devuelto` sí (D26). Los confirmados con compra van primero
 * (SCN-UI-C2); si no, en el orden de `previousScans` (del más reciente al más antiguo).
 */
export function findDuplicateScans(input: DuplicateScanInput): MatchPreviousScan[] {
  const number = normalizeInvoiceNumber(input.number);
  const previousScans = input.previousScans.filter((scan) => scan.purchaseStatus !== "cancelado");
  const mine = [input.contactId, input.supplierId].filter((id): id is string => Boolean(id));
  const sameSupplier = (scan: MatchPreviousScan) =>
    [scan.supplierId, scan.matchedContactId].some((id) => typeof id === "string" && mine.includes(id)) ||
    sameTaxId(input.taxId, scan.supplierTaxId);

  if (number) {
    const exact = previousScans.filter((scan) => normalizeInvoiceNumber(scan.number) === number && sameSupplier(scan));
    if (exact.length > 0) {
      return confirmedFirst(exact);
    }
  }

  const total = input.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return [];
  }
  const date = input.date?.trim() || undefined;
  if (!date && number) {
    return [];
  }

  return confirmedFirst(
    previousScans.filter((scan) => {
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
    }),
  );
}

/** El escaneo al que apunta el aviso: el primero de `findDuplicateScans`. */
export function findDuplicateScan(input: DuplicateScanInput): string | undefined {
  return findDuplicateScans(input)[0]?.scanId;
}

/**
 * SCN-UI-C2 (caos UI M2): de los escaneos que coinciden (del más reciente al más
 * antiguo), los confirmados con compra primero; un escaneo abandonado en `extracted`
 * no tapa la compra ya registrada.
 */
function confirmedFirst(scans: MatchPreviousScan[]): MatchPreviousScan[] {
  return [...scans.filter((scan) => Boolean(scan.purchaseId)), ...scans.filter((scan) => !scan.purchaseId)];
}
