import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { PurchaseStatus, SaleStatus } from "@/shared/mocks/erp-data";
import { applyCreatedAtCaracasRange } from "@/shared/utils/caracasBusinessDay";

import {
  buildOpenDocument,
  finalizeOpenDocuments,
  OPEN_PURCHASE_STATUSES,
  resolveOpenDocumentsDateRange,
  toOpenDocumentContact,
  type OpenDocument,
  type OpenDocumentsList,
  type OpenDocumentsQuery,
} from "./openDocuments.mock-server";

/**
 * Por que no hay RPC ni vista nueva: "con saldo" es `total_ves - paid_ves > 0` y
 * PostgREST no compara columna contra columna. En vez de anadir SQL, la lectura
 * empuja a la base todo lo que si se puede filtrar (tienda, estado, contacto y
 * rango de fechas), trae columnas ligeras por bloques y remata en servidor el
 * saldo, la busqueda, el orden y la pagina.
 *
 * - Ventas: se leen solo las `pendiente_pago`. `register_payment` y
 *   `cancel_payment` dejan `pagada` exactamente cuando `paid_ves >= total_ves`,
 *   asi que una venta `pagada` con saldo no es alcanzable por las RPC; leerlas
 *   obligaria a recorrer todo el historico de ventas cobradas. Se recorren de la
 *   mas antigua a la mas nueva: todas tienen saldo y el listado va por antiguedad.
 * - Compras: no existe una columna de estado de pago, asi que se leen las no
 *   canceladas ni devueltas, de la mas nueva a la mas antigua (si se llega al
 *   tope, lo que se pierde son compras viejas, casi siempre ya pagadas).
 *
 * Si alguna lectura llega a su tope, `totals.truncated` sale en `true`.
 */
export const OPEN_DOCUMENTS_SCAN_PAGE_SIZE = 1000;
export const OPEN_SALES_SCAN_LIMIT = 3000;
export const OPEN_PURCHASES_SCAN_LIMIT = 5000;

const SALE_SELECT =
  "id, invoice_number, status, created_at, ref_rate_ves, total_ref, total_ves, paid_ves, customer:contacts!sales_customer_id_fkey(id, name, tax_id)";

const PURCHASE_SELECT =
  "id, purchase_number, status, created_at, ref_rate_ves, total_ref, total_ves, paid_ves, paid_ref, supplier:contacts(id, name, tax_id)";

type ContactEmbed = { id: string; name: string; tax_id?: string | null };

type DocumentRowBase = {
  created_at: string;
  id: string;
  paid_ves: number | string | null;
  ref_rate_ves: number | string;
  total_ref: number | string;
  total_ves: number | string;
};

type SaleRow = DocumentRowBase & {
  customer?: ContactEmbed | ContactEmbed[] | null;
  invoice_number: string;
  status: SaleStatus;
};

type PurchaseRow = DocumentRowBase & {
  paid_ref: number | string | null;
  purchase_number: string;
  status: PurchaseStatus;
  supplier?: ContactEmbed | ContactEmbed[] | null;
};

type ScanPageResult = { data: unknown[] | null; error: unknown };

function mapContactEmbed(embed: ContactEmbed | ContactEmbed[] | null | undefined) {
  const contact = Array.isArray(embed) ? embed[0] : embed;

  return toOpenDocumentContact(
    contact ? { id: contact.id, name: contact.name, taxId: contact.tax_id } : undefined,
  );
}

/** Lee por bloques hasta agotar las filas o llegar al tope. */
async function scanRows<TRow>(
  fetchPage: (from: number, to: number) => PromiseLike<ScanPageResult>,
  scanLimit: number,
) {
  const rows: TRow[] = [];

  while (rows.length < scanLimit) {
    const pageSize = Math.min(OPEN_DOCUMENTS_SCAN_PAGE_SIZE, scanLimit - rows.length);
    const { data, error } = await fetchPage(rows.length, rows.length + pageSize - 1);
    throwIfSupabaseError(error);

    const page = (data ?? []) as TRow[];
    rows.push(...page);

    if (page.length < pageSize) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}

export async function listOpenDocuments(
  query: OpenDocumentsQuery,
  storeId: string,
  now: Date = new Date(),
): Promise<OpenDocumentsList> {
  const supabase = await createRouteSupabaseClient();
  const range = resolveOpenDocumentsDateRange(query, now);
  const documents: Array<OpenDocument | null> = [];
  let truncated = false;

  if (query.types.includes("sale")) {
    const scan = await scanRows<SaleRow>((from, to) => {
      let salesQuery = supabase
        .from("sales")
        .select(SALE_SELECT)
        .eq("store_id", storeId)
        .eq("status", "pendiente_pago");

      if (query.contactId) {
        salesQuery = salesQuery.eq("customer_id", query.contactId);
      }

      return applyCreatedAtCaracasRange(salesQuery, range.from, range.to)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    }, OPEN_SALES_SCAN_LIMIT);

    truncated = truncated || scan.truncated;
    documents.push(
      ...scan.rows.map((row) =>
        buildOpenDocument({
          contact: mapContactEmbed(row.customer),
          createdAt: row.created_at,
          id: row.id,
          number: row.invoice_number,
          paidVes: Number(row.paid_ves ?? 0),
          refRateVes: Number(row.ref_rate_ves),
          status: row.status,
          totalRef: Number(row.total_ref),
          totalVes: Number(row.total_ves),
          type: "sale",
        }),
      ),
    );
  }

  if (query.types.includes("purchase")) {
    const scan = await scanRows<PurchaseRow>((from, to) => {
      let purchasesQuery = supabase
        .from("purchases")
        .select(PURCHASE_SELECT)
        .eq("store_id", storeId)
        .in("status", [...OPEN_PURCHASE_STATUSES]);

      if (query.contactId) {
        purchasesQuery = purchasesQuery.eq("supplier_id", query.contactId);
      }

      return applyCreatedAtCaracasRange(purchasesQuery, range.from, range.to)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
    }, OPEN_PURCHASES_SCAN_LIMIT);

    truncated = truncated || scan.truncated;
    documents.push(
      ...scan.rows.map((row) =>
        buildOpenDocument({
          contact: mapContactEmbed(row.supplier),
          createdAt: row.created_at,
          id: row.id,
          number: row.purchase_number,
          paidRef: Number(row.paid_ref ?? 0),
          paidVes: Number(row.paid_ves ?? 0),
          refRateVes: Number(row.ref_rate_ves),
          status: row.status,
          totalRef: Number(row.total_ref),
          totalVes: Number(row.total_ves),
          type: "purchase",
        }),
      ),
    );
  }

  return finalizeOpenDocuments(
    documents.filter((document): document is OpenDocument => document !== null),
    query,
    truncated,
  );
}
