import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { listCountOptions } from "@/modules/products/services/listRange";

import {
  agingDocumentHref,
  buildAgingSummary,
  buildCashCloseDifferencesReport,
  buildSalesByCategoryReport,
  buildSalesByHourReport,
  CASH_CLOSE_CURRENCIES,
  type AgingBucket,
  type AgingDocumentRow,
  type AgingDocumentType,
  type AgingQuery,
  type AgingReport,
  type CashCloseCurrency,
  type CashCloseCurrencyWindow,
  type CashCloseDifferencesQuery,
  type CashCloseDifferencesReport,
  type CashCloseLedgerRow,
  type CashCloseRunning,
  type MoneyReportRange,
  type SalesByCategoryReport,
  type SalesByHourReport,
} from "./moneyReports";
import { fetchAllRows, fetchCountedPage } from "./reportPagination";

/**
 * Reportes de dinero (REP-06) sobre las vistas `report_*` del parche
 * `20261013a`. Solo lectura, con la sesión del usuario: las vistas son
 * `security_invoker`, así que mandan las RLS de las tablas base. `storeId`
 * llega siempre del servidor (contexto de autenticación de la ruta).
 */

type Numeric = number | string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// 1. Ventas por hora
// ---------------------------------------------------------------------------

type DbSalesByHourRow = {
  dow: number;
  hour: number;
  sale_date: string;
  sales_count: Numeric;
  total_ref: Numeric;
  total_ves: Numeric;
};

export async function getSalesByHourReport(
  range: MoneyReportRange,
  storeId: string,
): Promise<SalesByHourReport> {
  const supabase = await createRouteSupabaseClient();
  // (sale_date, hour) es único por tienda: orden estable entre páginas.
  const rows = await fetchAllRows<DbSalesByHourRow>(
    async (from, to) => {
      const { count, data, error, status } = await supabase
        .from("report_sales_by_hour")
        .select("sale_date, dow, hour, sales_count, total_ref, total_ves", { count: "exact" })
        .eq("store_id", storeId)
        .gte("sale_date", range.from)
        .lte("sale_date", range.to)
        .order("sale_date", { ascending: true })
        .order("hour", { ascending: true })
        .range(from, to);

      return { count, data: data as unknown as DbSalesByHourRow[] | null, error, status };
    },
    { getKey: (row) => `${row.sale_date}|${row.hour}` },
  );

  return buildSalesByHourReport(
    range,
    rows.map((row) => ({
      dow: Number(row.dow),
      hour: Number(row.hour),
      salesCount: Number(row.sales_count),
      totalRef: Number(row.total_ref),
      totalVes: Number(row.total_ves),
    })),
  );
}

// ---------------------------------------------------------------------------
// 2. Ventas y margen por categoría
// ---------------------------------------------------------------------------

type DbSalesByCategoryRow = {
  category_id: string | null;
  category_name: string;
  cost_ref: Numeric;
  gross_profit_ref: Numeric;
  revenue_ref: Numeric;
  sale_date: string;
  units: Numeric;
};

export async function getSalesByCategoryReport(
  range: MoneyReportRange,
  storeId: string,
): Promise<SalesByCategoryReport> {
  const supabase = await createRouteSupabaseClient();
  // (sale_date, category_id) es único por tienda (una sola fila sin categoría por día).
  const rows = await fetchAllRows<DbSalesByCategoryRow>(
    async (from, to) => {
      const { count, data, error, status } = await supabase
        .from("report_sales_by_category")
        .select("sale_date, category_id, category_name, units, revenue_ref, cost_ref, gross_profit_ref", {
          count: "exact",
        })
        .eq("store_id", storeId)
        .gte("sale_date", range.from)
        .lte("sale_date", range.to)
        .order("sale_date", { ascending: true })
        .order("category_id", { ascending: true, nullsFirst: false })
        .range(from, to);

      return { count, data: data as unknown as DbSalesByCategoryRow[] | null, error, status };
    },
    { getKey: (row) => `${row.sale_date}|${row.category_id ?? ""}` },
  );

  return buildSalesByCategoryReport(
    range,
    rows.map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      costRef: Number(row.cost_ref),
      grossProfitRef: Number(row.gross_profit_ref),
      revenueRef: Number(row.revenue_ref),
      units: Number(row.units),
    })),
  );
}

// ---------------------------------------------------------------------------
// 3 y 4. Cuentas por cobrar / por pagar con antigüedad
// ---------------------------------------------------------------------------

const AGING_COLUMNS =
  "document_id, document_number, contact_id, contact_name, created_at, document_date, days, bucket, ref_rate_ves, total_ref, total_ves, paid_ref, paid_ves, pending_ref, pending_ves";

type DbAgingRow = {
  bucket: AgingBucket;
  contact_id: string;
  contact_name: string | null;
  created_at: string;
  days: number;
  document_date: string;
  document_id: string;
  document_number: string;
  paid_ref: Numeric;
  paid_ves: Numeric;
  pending_ref: Numeric;
  pending_ves: Numeric;
  ref_rate_ves: Numeric;
  total_ref: Numeric;
  total_ves: Numeric;
};

type DbAgingSummaryRow = {
  bucket: string;
  documents_count: Numeric;
  pending_ref: Numeric;
  pending_ves: Numeric;
};

function mapAgingRow(type: AgingDocumentType, row: DbAgingRow): AgingDocumentRow {
  return {
    bucket: row.bucket,
    contact: row.contact_name === null ? null : { id: row.contact_id, name: row.contact_name },
    createdAt: row.created_at,
    date: row.document_date,
    days: Number(row.days),
    document: {
      href: agingDocumentHref(type, row.document_id),
      id: row.document_id,
      number: row.document_number,
      type,
    },
    paidRef: Number(row.paid_ref),
    paidVes: Number(row.paid_ves),
    pendingRef: Number(row.pending_ref),
    pendingVes: Number(row.pending_ves),
    refRateVes: Number(row.ref_rate_ves),
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
  };
}

/**
 * Página de documentos abiertos (más antiguo primero, `document_id` de
 * desempate) y resumen por tramo. La página y el conteo los hace la base sobre
 * `report_open_documents_aging`; el resumen sale de
 * `report_open_documents_aging_summary` (a lo sumo tres filas): nunca se leen
 * todos los documentos.
 */
async function getAgingReport(
  type: AgingDocumentType,
  query: AgingQuery,
  storeId: string,
): Promise<AgingReport> {
  // Las columnas de contacto son uuid: un id que no lo es no puede tener documentos.
  if (query.contactId !== undefined && !UUID.test(query.contactId)) {
    return { items: [], limit: query.limit, skip: query.skip, summary: buildAgingSummary([]), total: 0 };
  }

  const supabase = await createRouteSupabaseClient();

  const buildQuery = (head: boolean) => {
    let documents = supabase
      .from("report_open_documents_aging")
      .select(head ? "document_id" : AGING_COLUMNS, listCountOptions(head))
      .eq("store_id", storeId)
      .eq("doc_type", type);

    if (query.bucket) {
      documents = documents.eq("bucket", query.bucket);
    }

    if (query.contactId) {
      documents = documents.eq("contact_id", query.contactId);
    }

    return documents;
  };

  const summaryQuery = supabase
    .from("report_open_documents_aging_summary")
    .select("bucket, documents_count, pending_ref, pending_ves")
    .eq("store_id", storeId)
    .eq("doc_type", type);

  const [page, summary] = await Promise.all([
    fetchCountedPage<unknown>({
      count: () => buildQuery(true),
      rows: () =>
        buildQuery(false)
          .order("created_at", { ascending: true })
          .order("document_id", { ascending: true })
          .range(query.skip, query.skip + query.limit - 1),
    }),
    query.contactId ? summaryQuery.eq("contact_id", query.contactId) : summaryQuery.is("contact_id", null),
  ]);

  throwIfSupabaseError(summary.error);

  return {
    items: (page.rows as DbAgingRow[]).map((row) => mapAgingRow(type, row)),
    limit: query.limit,
    skip: query.skip,
    summary: buildAgingSummary(
      ((summary.data ?? []) as DbAgingSummaryRow[]).map((row) => ({
        bucket: row.bucket,
        documentsCount: Number(row.documents_count),
        pendingRef: Number(row.pending_ref),
        pendingVes: Number(row.pending_ves),
      })),
    ),
    total: page.total,
  };
}

/** Ventas por cobrar con antigüedad. */
export function getReceivablesAgingReport(query: AgingQuery, storeId: string) {
  return getAgingReport("sale", query, storeId);
}

/** Compras por pagar con antigüedad. */
export function getPayablesAgingReport(query: AgingQuery, storeId: string) {
  return getAgingReport("purchase", query, storeId);
}

// ---------------------------------------------------------------------------
// 5. Diferencias de cierre de caja
// ---------------------------------------------------------------------------

const CASH_CLOSE_COLUMNS =
  "cash_session_id, register_id, register_name, closed_at, close_date, closed_reason, currency, expected, counted, difference, running_expected, running_counted, running_difference";

const CASH_CLOSE_RUNNING_COLUMNS = "running_expected, running_counted, running_difference";

type DbCashCloseRunningRow = {
  running_counted: Numeric;
  running_difference: Numeric;
  running_expected: Numeric;
};

type DbCashCloseRow = DbCashCloseRunningRow & {
  cash_session_id: string;
  close_date: string;
  closed_at: string;
  closed_reason: CashCloseLedgerRow["closedReason"];
  counted: Numeric;
  currency: CashCloseCurrency;
  difference: Numeric;
  expected: Numeric;
  register_id: string;
  register_name: string | null;
};

function mapRunning(row: DbCashCloseRunningRow | undefined): CashCloseRunning | null {
  return row
    ? {
        counted: Number(row.running_counted),
        difference: Number(row.running_difference),
        expected: Number(row.running_expected),
      }
    : null;
}

/**
 * Diferencias de cierre (contado − teórico guardado) por sesión y moneda, del
 * cierre más reciente al más antiguo. Los totales y el acumulado salen de las
 * columnas `running_*` de la vista: por moneda se lee el último cierre del
 * rango y el último anterior a él, no el rango entero.
 */
export async function getCashCloseDifferencesReport(
  query: CashCloseDifferencesQuery,
  storeId: string,
): Promise<CashCloseDifferencesReport> {
  const supabase = await createRouteSupabaseClient();

  const inRange = (columns: string, options: { count: "exact"; head?: true }) => {
    let rows = supabase.from("report_cash_close_differences").select(columns, options).eq("store_id", storeId);

    if (query.from) {
      rows = rows.gte("close_date", query.from);
    }

    if (query.to) {
      rows = rows.lte("close_date", query.to);
    }

    return rows;
  };

  const buildPageQuery = (head: boolean) => {
    const rows = inRange(head ? "cash_session_id" : CASH_CLOSE_COLUMNS, listCountOptions(head));

    return query.currency ? rows.eq("currency", query.currency) : rows;
  };

  const readWindow = async (currency: CashCloseCurrency): Promise<CashCloseCurrencyWindow> => {
    const [last, baseline] = await Promise.all([
      inRange(CASH_CLOSE_RUNNING_COLUMNS, { count: "exact" })
        .eq("currency", currency)
        .order("closed_at", { ascending: false })
        .order("cash_session_id", { ascending: false })
        .limit(1),
      query.from
        ? supabase
            .from("report_cash_close_differences")
            .select(CASH_CLOSE_RUNNING_COLUMNS)
            .eq("store_id", storeId)
            .eq("currency", currency)
            .lt("close_date", query.from)
            .order("closed_at", { ascending: false })
            .order("cash_session_id", { ascending: false })
            .limit(1)
        : null,
    ]);

    throwIfSupabaseError(last.error);
    throwIfSupabaseError(baseline?.error ?? null);

    return {
      baseline: mapRunning((baseline?.data as unknown as DbCashCloseRunningRow[] | null | undefined)?.[0]),
      last: mapRunning((last.data as unknown as DbCashCloseRunningRow[] | null)?.[0]),
      sessionsCount: last.count ?? 0,
    };
  };

  const [page, ves, ref] = await Promise.all([
    fetchCountedPage<unknown>({
      count: () => buildPageQuery(true),
      rows: () =>
        buildPageQuery(false)
          .order("closed_at", { ascending: false })
          .order("cash_session_id", { ascending: false })
          .order("currency", { ascending: true })
          .range(query.skip, query.skip + query.limit - 1),
    }),
    ...CASH_CLOSE_CURRENCIES.map(readWindow),
  ]);

  return buildCashCloseDifferencesReport({
    page: (page.rows as DbCashCloseRow[]).map((row) => ({
      cashSessionId: row.cash_session_id,
      closeDate: row.close_date,
      closedAt: row.closed_at,
      closedReason: row.closed_reason,
      counted: Number(row.counted),
      currency: row.currency,
      difference: Number(row.difference),
      expected: Number(row.expected),
      registerId: row.register_id,
      registerName: row.register_name,
      runningCounted: Number(row.running_counted),
      runningDifference: Number(row.running_difference),
      runningExpected: Number(row.running_expected),
    })),
    query,
    total: page.total,
    windows: { ref: ref!, ves: ves! },
  });
}
