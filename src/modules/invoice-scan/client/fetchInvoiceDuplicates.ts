import { apiFetch } from "@/shared/api/apiFetch";

import {
  getInvoiceDateIssue,
  withoutSpaces,
  type InvoiceDuplicateMatch,
  type InvoiceDuplicateQuery,
} from "../contracts";
import { invoiceDateKey } from "../server/match/text";

export const INVOICE_DUPLICATES_PATH = "/api/purchases/invoice-scan/duplicates";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAX_ID_PATTERN = /^[A-Za-z0-9 .-]{1,20}$/;
const MAX_NUMBER_LENGTH = 64;

/**
 * REP12-01: consulta de duplicados de la revisión con lo que el endpoint acepta (lo que no
 * valdría se omite). `null` si no hay con qué buscar: ningún proveedor (elegido, leído o RIF)
 * o ni número ni total.
 * REP15-02: la fecha solo si es una fecha de calendario real (`getInvoiceDateIssue`: una
 * imposible como 2026-02-31 daba 400 y «No se pudo comprobar…», B-p16B-3) y como clave ISO
 * (`invoiceDateKey`: DD/MM/AAAA leída = AAAA-MM-DD de la revisión, B-p16B-1); el número sin
 * espacios Unicode ni tabuladores (`withoutSpaces`, B-p16-1).
 */
export function buildInvoiceDuplicateQuery(input: {
  scanId?: string;
  supplierId?: string;
  contactId?: string;
  taxId?: string;
  number?: string;
  date?: string;
  total?: number;
}): InvoiceDuplicateQuery | null {
  const id = (value: string | undefined) => (value && ID_PATTERN.test(value) ? value : undefined);
  const taxId = input.taxId?.trim();
  const number = input.number === undefined ? undefined : withoutSpaces(input.number);
  const query: InvoiceDuplicateQuery = {
    scanId: input.scanId && UUID_PATTERN.test(input.scanId) ? input.scanId : undefined,
    supplierId: id(input.supplierId),
    contactId: id(input.contactId),
    taxId: taxId && TAX_ID_PATTERN.test(taxId) ? taxId : undefined,
    number: number && number.length <= MAX_NUMBER_LENGTH && !/\p{Cc}/u.test(number) ? number : undefined,
    date: input.date && getInvoiceDateIssue(input.date) === undefined ? invoiceDateKey(input.date) : undefined,
    total:
      typeof input.total === "number" && Number.isFinite(input.total) && input.total > 0 && input.total <= 1e12
        ? input.total
        : undefined,
  };
  if (!query.supplierId && !query.contactId && !query.taxId) {
    return null;
  }
  if (query.number === undefined && query.total === undefined) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  ) as InvoiceDuplicateQuery;
}

/** `POST /api/purchases/invoice-scan/duplicates` (el número va en el cuerpo, D35). */
export function fetchInvoiceDuplicates(
  query: InvoiceDuplicateQuery,
  signal: AbortSignal,
): Promise<InvoiceDuplicateMatch[]> {
  return apiFetch<InvoiceDuplicateMatch[]>(INVOICE_DUPLICATES_PATH, { body: query, method: "POST", signal });
}
