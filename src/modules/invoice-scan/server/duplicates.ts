import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "../contracts";
import { findDuplicateScans } from "./match/duplicate";
import type { MatchPreviousScan } from "./match.types";

/**
 * REP12-01 (D52/D53): escaneos de la tienda que serían la misma factura que la revisión, con la
 * misma regla que `matched.duplicateOfScanId` (`findDuplicateScans`), sumando el proveedor
 * elegido. `previousScans` sale de `loadPreviousScans` (o su paridad mock) con el número, la
 * fecha y el total de la consulta y sin el escaneo en revisión. `contactTaxIds`: RIF guardado
 * (contactos de la tienda) del proveedor elegido y del contacto leído de la consulta.
 */
export function toInvoiceDuplicateMatches(
  query: InvoiceDuplicateQuery,
  previousScans: MatchPreviousScan[],
  contactTaxIds: string[] = [],
): InvoiceDuplicateMatch[] {
  return findDuplicateScans({
    number: query.number,
    date: query.date,
    total: query.total,
    contactId: query.contactId,
    supplierId: query.supplierId,
    taxId: query.taxId,
    contactTaxIds,
    previousScans,
  }).map((scan) => ({
    scanId: scan.scanId,
    purchaseId: scan.purchaseId ?? null,
    number: scan.number ?? null,
    date: scan.date ?? null,
  }));
}
