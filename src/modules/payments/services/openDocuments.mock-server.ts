import type { PaginatedList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPurchases,
  mockSales,
  type PurchaseStatus,
  type SaleStatus,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import {
  getCaracasIsoDate,
  isUtcTimestampInCaracasDateRange,
  shiftIsoDate,
} from "@/shared/utils/caracasBusinessDay";
import { roundMoney } from "@/shared/utils/currency";

import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";

export type OpenDocumentType = "purchase" | "sale";

export type OpenDocumentContact = {
  id: string;
  name: string;
  taxId?: string;
};

/** Venta por cobrar o compra por pagar: un documento que `register_payment` aun acepta. */
export type OpenDocument = {
  contact?: OpenDocumentContact;
  createdAt: string;
  id: string;
  /** `invoice_number` de la venta o `purchase_number` de la compra, tal cual se guarda. */
  number: string;
  /** Solo compras: las ventas no guardan lo cobrado en REF. */
  paidRef?: number;
  paidVes: number;
  /** Compras: `totalRef - paidRef`. Ventas: el saldo en Bs a la tasa del documento. */
  pendingRef?: number;
  pendingVes: number;
  refRateVes: number;
  status: PurchaseStatus | SaleStatus;
  totalRef: number;
  totalVes: number;
  type: OpenDocumentType;
};

export type OpenDocumentsTotals = {
  count: number;
  pendingRef?: number;
  pendingVes: number;
  /**
   * `true` cuando la lectura alcanzo el tope de filas y el conjunto (y por tanto
   * estos totales) puede estar incompleto. El mock nunca trunca.
   */
  truncated: boolean;
};

export type OpenDocumentsList = PaginatedList<OpenDocument> & {
  /** Suma del conjunto filtrado completo, no solo de la pagina. */
  totals: OpenDocumentsTotals;
};

/** Filtros ya validados por la ruta; `types` sale de los permisos, no del cliente. */
export type OpenDocumentsQuery = {
  contactId?: string;
  from?: string;
  limit: number;
  olderThanDays?: number;
  search?: string;
  skip: number;
  to?: string;
  types: readonly OpenDocumentType[];
};

/** Estados de venta en los que `register_payment` acepta un cobro. */
export const OPEN_SALE_STATUSES: readonly SaleStatus[] = ["pendiente_pago", "pagada"];

/** Estados de compra en los que `register_payment` acepta un pago (ni cancelada ni devuelta). */
export const OPEN_PURCHASE_STATUSES: readonly PurchaseStatus[] = ["pedido", "recibido"];

type OpenDocumentSource = {
  contact?: OpenDocumentContact;
  createdAt: string;
  id: string;
  number: string;
  paidRef?: number;
  paidVes: number;
  refRateVes: number;
  status: PurchaseStatus | SaleStatus;
  totalRef: number;
  totalVes: number;
  type: OpenDocumentType;
};

/**
 * Arma el documento con su saldo, o `null` si no queda nada por pagar. El saldo
 * usa el mismo redondeo que el detalle (`roundMoney`), igual que el
 * `round(total_ves - paid_ves, 2)` de `register_payment`.
 */
export function buildOpenDocument(source: OpenDocumentSource): OpenDocument | null {
  const pendingVes = roundMoney(source.totalVes - source.paidVes);

  if (pendingVes <= 0) {
    return null;
  }

  const base = {
    contact: source.contact,
    createdAt: source.createdAt,
    id: source.id,
    number: source.number,
    paidVes: source.paidVes,
    pendingVes,
    refRateVes: source.refRateVes,
    status: source.status,
    totalRef: source.totalRef,
    totalVes: source.totalVes,
    type: source.type,
  };

  if (source.type === "purchase") {
    const paidRef = source.paidRef ?? 0;

    return {
      ...base,
      paidRef,
      pendingRef: Math.max(roundMoney(source.totalRef - paidRef), 0),
    };
  }

  return source.refRateVes > 0
    ? { ...base, pendingRef: roundMoney(pendingVes / source.refRateVes) }
    : base;
}

export function toOpenDocumentContact(
  contact: { id: string; name: string; taxId?: string | null } | null | undefined,
): OpenDocumentContact | undefined {
  if (!contact) {
    return undefined;
  }

  const taxId = contact.taxId?.trim();

  return taxId
    ? { id: contact.id, name: contact.name, taxId }
    : { id: contact.id, name: contact.name };
}

/**
 * Rango de fechas Caracas efectivo. `olderThanDays = N` deja los documentos cuya
 * fecha Caracas es de hace N dias o mas (fecha <= hoy - N), y se combina con `to`
 * quedandose con el limite mas antiguo.
 */
export function resolveOpenDocumentsDateRange(
  query: Pick<OpenDocumentsQuery, "from" | "olderThanDays" | "to">,
  now: Date = new Date(),
) {
  if (!query.olderThanDays) {
    return { from: query.from, to: query.to };
  }

  const cutoff = shiftIsoDate(getCaracasIsoDate(now), -query.olderThanDays);

  return {
    from: query.from,
    to: query.to && query.to < cutoff ? query.to : cutoff,
  };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Busca por numero del documento (crudo o como se muestra) y por nombre o RIF del contacto. */
export function openDocumentMatchesSearch(document: OpenDocument, search: string | undefined) {
  const term = normalizeSearch(search ?? "");

  if (!term) {
    return true;
  }

  const candidates = [
    document.number,
    document.type === "purchase" ? formatPurchaseNumberDisplay(document.number) : "",
    document.contact?.name ?? "",
    document.contact?.taxId ?? "",
  ];

  return candidates.some((candidate) => normalizeSearch(candidate).includes(term));
}

/**
 * Remate comun a mock y Supabase: aplica la busqueda, ordena por antiguedad (mas
 * antiguo primero), suma los totales del conjunto y corta la pagina.
 */
export function finalizeOpenDocuments(
  documents: OpenDocument[],
  query: Pick<OpenDocumentsQuery, "limit" | "search" | "skip">,
  truncated = false,
): OpenDocumentsList {
  const filtered = documents
    .filter((document) => openDocumentMatchesSearch(document, query.search))
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
        left.id.localeCompare(right.id),
    );

  const withRef = filtered.filter((document) => document.pendingRef !== undefined);
  const totals: OpenDocumentsTotals = {
    count: filtered.length,
    pendingVes: roundMoney(filtered.reduce((sum, document) => sum + document.pendingVes, 0)),
    truncated,
  };

  if (withRef.length > 0) {
    totals.pendingRef = roundMoney(
      withRef.reduce((sum, document) => sum + (document.pendingRef ?? 0), 0),
    );
  }

  return {
    items: filtered.slice(query.skip, query.skip + query.limit),
    limit: query.limit,
    skip: query.skip,
    total: filtered.length,
    totals,
  };
}

function findContact(contactId: string) {
  return toOpenDocumentContact(mockContacts.find((contact) => contact.id === contactId));
}

export async function listOpenDocuments(
  query: OpenDocumentsQuery,
  storeId: string,
  now: Date = new Date(),
): Promise<OpenDocumentsList> {
  const range = resolveOpenDocumentsDateRange(query, now);
  const inRange = (createdAt: string) =>
    isUtcTimestampInCaracasDateRange(createdAt, range.from, range.to);
  const documents: Array<OpenDocument | null> = [];

  if (query.types.includes("sale")) {
    documents.push(
      ...mockSales
        .filter(
          (sale) =>
            (sale.storeId ?? DEFAULT_STORE_ID) === storeId &&
            OPEN_SALE_STATUSES.includes(sale.status) &&
            (!query.contactId || sale.customerId === query.contactId) &&
            inRange(sale.createdAt),
        )
        .map((sale) =>
          buildOpenDocument({
            contact: findContact(sale.customerId),
            createdAt: sale.createdAt,
            id: sale.id,
            number: sale.invoiceNumber,
            paidVes: sale.paidVes,
            refRateVes: sale.refRateVes,
            status: sale.status,
            totalRef: sale.totalRef,
            totalVes: sale.totalVes,
            type: "sale",
          }),
        ),
    );
  }

  if (query.types.includes("purchase")) {
    documents.push(
      ...mockPurchases
        .filter(
          (purchase) =>
            (purchase.storeId ?? DEFAULT_STORE_ID) === storeId &&
            OPEN_PURCHASE_STATUSES.includes(purchase.status) &&
            (!query.contactId || purchase.supplierId === query.contactId) &&
            inRange(purchase.createdAt),
        )
        .map((purchase) =>
          buildOpenDocument({
            contact: findContact(purchase.supplierId),
            createdAt: purchase.createdAt,
            id: purchase.id,
            number: purchase.purchaseNumber,
            paidRef: purchase.paidRef,
            paidVes: purchase.paidVes,
            refRateVes: purchase.refRateVes,
            status: purchase.status,
            totalRef: purchase.totalRef,
            totalVes: purchase.totalVes,
            type: "purchase",
          }),
        ),
    );
  }

  return finalizeOpenDocuments(
    documents.filter((document): document is OpenDocument => document !== null),
    query,
  );
}
