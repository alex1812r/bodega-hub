import type { MatchPreviousScan } from "../match.types";

import { normalizeInvoiceNumber, normalizeTaxId } from "./text";

/**
 * Escaneo anterior del mismo proveedor (por `contactId` resuelto o por RIF
 * normalizado) con el mismo número de factura normalizado.
 */
export function findDuplicateScan(input: {
  number: string | undefined;
  contactId: string | undefined;
  taxId: string | undefined;
  previousScans: MatchPreviousScan[];
}): string | undefined {
  const number = normalizeInvoiceNumber(input.number);
  if (!number) {
    return undefined;
  }
  const taxId = normalizeTaxId(input.taxId);

  const match = input.previousScans.find((scan) => {
    if (normalizeInvoiceNumber(scan.number) !== number) {
      return false;
    }
    const sameContact = input.contactId !== undefined && scan.supplierId === input.contactId;
    const sameTaxId = taxId !== "" && normalizeTaxId(scan.supplierTaxId) === taxId;
    return sameContact || sameTaxId;
  });

  return match?.scanId;
}
