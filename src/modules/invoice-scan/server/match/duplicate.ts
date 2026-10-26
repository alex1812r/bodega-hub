import type { MatchPreviousScan } from "../match.types";

import { invoiceDateKey, normalizeInvoiceNumber, sameTaxId, withinOneEdit } from "./text";

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
  /**
   * REP12-01 (D53): RIF guardado (`contacts.tax_id` de la tienda) del proveedor elegido y del
   * contacto leído del escaneo actual.
   */
  contactTaxIds?: (string | null | undefined)[];
  previousScans: MatchPreviousScan[];
};

/**
 * Escaneos anteriores que serían la misma factura (REP12-01, D53: la única regla, la usan el
 * emparejamiento y `POST /api/purchases/invoice-scan/duplicates`). Mismo proveedor si casa
 * cualquiera de los del actual (elegido o contacto leído) con cualquiera del previo (elegido al
 * confirmar o contacto leído), o cualquier RIF del actual (el leído o el guardado de sus contactos) con
 * cualquiera del previo (`sameTaxId`). Con el mismo número de factura
 * normalizado; si no hay ninguno, posible duplicado (caos 5.4): mismo proveedor, mismo total
 * (±0,01) y
 * - número que difiere en un solo carácter y misma fecha, o
 * - sin número leído y misma fecha (o sin fecha leída tampoco), o
 * - previo sin ningún número (ni leído ni confirmado) y misma fecha (REP14-01).
 * El número del previo es el leído (`readNumber`) o el efectivo (`number`): casa cualquiera
 * (REP14-01, D63). Igual la fecha y el total del previo: casa el leído (`readDate`, `readTotal`)
 * o el efectivo (`date`, `total`: el confirmado si no está vacío) (REP14-05); la fecha se compara
 * por `invoiceDateKey` (DD/MM/AAAA = AAAA-MM-DD, REP14-05b). El escaneo de una compra anulada (`cancelado`) no cuenta: la factura no quedó registrada
 * (REP3-03a). La compra `devuelto` sí (D26). Los confirmados con compra van primero
 * (SCN-UI-C2); si no, en el orden de `previousScans` (del más reciente al más antiguo).
 */
export function findDuplicateScans(input: DuplicateScanInput): MatchPreviousScan[] {
  const number = normalizeInvoiceNumber(input.number);
  const previousScans = input.previousScans.filter((scan) => scan.purchaseStatus !== "cancelado");
  const mine = [input.contactId, input.supplierId].filter((id): id is string => Boolean(id));
  const sameSupplier = (scan: MatchPreviousScan) =>
    [scan.supplierId, scan.matchedContactId].some((id) => typeof id === "string" && mine.includes(id)) ||
    [input.taxId, ...(input.contactTaxIds ?? [])].some((mineTaxId) =>
      [scan.supplierTaxId, ...(scan.contactTaxIds ?? [])].some((theirTaxId) => sameTaxId(mineTaxId, theirTaxId)),
    );

  const numbersOf = (scan: MatchPreviousScan) =>
    [scan.number, scan.readNumber].map(normalizeInvoiceNumber).filter((value) => value !== "");

  if (number) {
    const exact = previousScans.filter((scan) => numbersOf(scan).includes(number) && sameSupplier(scan));
    if (exact.length > 0) {
      return confirmedFirst(exact);
    }
  }

  const total = input.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return [];
  }
  const date = invoiceDateKey(input.date) || undefined;
  if (!date && number) {
    return [];
  }

  return confirmedFirst(
    previousScans.filter((scan) => {
      // REP14-05: total y fecha, el leído o el efectivo (confirmado) del previo.
      const totals = [scan.total, scan.readTotal].filter((value): value is number => typeof value === "number");
      if (!totals.some((their) => Math.abs(their - total) <= DUPLICATE_TOTAL_TOLERANCE)) {
        return false;
      }
      // REP14-05b: por la fecha del calendario (DD/MM/AAAA = AAAA-MM-DD), no por el texto.
      if (date && ![scan.date, scan.readDate].some((their) => invoiceDateKey(their) === date)) {
        return false;
      }
      // REP14-01: un previo sin ningún número no descarta; con número, a un carácter de alguno.
      const theirs = numbersOf(scan);
      if (number && theirs.length > 0 && !theirs.some((their) => withinOneEdit(number, their))) {
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
