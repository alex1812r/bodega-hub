import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { normalizeStoreIds } from "@/modules/reports/services/storeScope";

import { shiftIsoDate } from "../utils/businessDate";

type DbSale = {
  created_at: string;
  customer_id: string;
  discount_ref: number | string;
  id: string;
  invoice_number: string;
  paid_ves: number | string;
  ref_rate_ves: number | string;
  status: string;
  store_id?: string;
  subtotal_ref: number | string;
  tax_ref: number | string;
  total_ref: number | string;
  total_ves: number | string;
  user_id: string | null;
};

type DbProduct = {
  category_id: string | null;
  current_cost_ref: number | string;
  current_stock: number;
  id: string;
  image_url: string | null;
  is_active: boolean;
  min_stock: number;
  name: string;
  sale_price_ref: number | string;
  sku: string;
  store_id?: string;
};

export type DashboardQueryOptions = {
  useAdmin?: boolean;
};

const METRICS_SALE_STATUSES = ["borrador", "pagada", "pendiente_pago"] as const;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function getDashboardClient(options?: DashboardQueryOptions) {
  return options?.useAdmin ? createAdminSupabaseClient() : await createRouteSupabaseClient();
}

function applyStoreIdsFilter<
  T extends {
    eq: (col: string, val: string) => T;
    in: (col: string, vals: string[]) => T;
  },
>(query: T, storeIds: string[]) {
  if (storeIds.length === 1) {
    return query.eq("store_id", storeIds[0]!);
  }

  return query.in("store_id", storeIds);
}

function mapLowStockProduct(row: DbProduct & { store_name?: string | null }) {
  return {
    currentStock: row.current_stock,
    id: row.id,
    minStock: row.min_stock,
    name: row.name,
    sku: row.sku,
    storeId: row.store_id,
    storeName: row.store_name ?? undefined,
  };
}

function applyCreatedAtRange<T extends { gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(
  query: T,
  from: string | null,
  to: string | null,
) {
  let next = query;

  if (from) {
    next = next.gte("created_at", `${from}T00:00:00.000Z`);
  }

  if (to) {
    next = next.lte("created_at", `${to}T23:59:59.999Z`);
  }

  return next;
}

function sumDailyRows(
  rows:
    | Array<{ sales_count?: number | null; total_ref?: number | string | null; total_ves?: number | string | null }>
    | { sales_count?: number | null; total_ref?: number | string | null; total_ves?: number | string | null }
    | null
    | undefined,
) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return list.reduce(
    (acc, row) => ({
      salesCount: acc.salesCount + Number(row.sales_count ?? 0),
      totalRef: acc.totalRef + Number(row.total_ref ?? 0),
      totalVes: acc.totalVes + Number(row.total_ves ?? 0),
    }),
    { salesCount: 0, totalRef: 0, totalVes: 0 },
  );
}

export async function getDashboardSummary(
  storeIdOrIds: string | string[],
  options?: DashboardQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const supabase = await getDashboardClient(options);
  const today = todayIsoDate();

  let todayQuery = supabase
    .from("daily_sales_summary")
    .select("sales_count, total_ref, total_ves")
    .eq("sale_date", today);
  todayQuery = applyStoreIdsFilter(todayQuery, storeIds);

  const { data: todayRows, error: todayError } = await todayQuery;
  throwIfSupabaseError(todayError);

  const todayTotals = sumDailyRows(todayRows ?? []);

  let lowStockQuery = supabase.from("low_stock_products").select("id", { count: "exact", head: true });
  lowStockQuery = applyStoreIdsFilter(lowStockQuery, storeIds);
  const { count: lowStockCount, error: lowStockError } = await lowStockQuery;
  throwIfSupabaseError(lowStockError);

  let pendingQuery = supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendiente_pago");
  pendingQuery = applyStoreIdsFilter(pendingQuery, storeIds);
  const { count: pendingSalesCount, error: pendingError } = await pendingQuery;
  throwIfSupabaseError(pendingError);

  const yesterday = shiftIsoDate(today, -1);
  let yesterdayQuery = supabase
    .from("daily_sales_summary")
    .select("total_ref")
    .eq("sale_date", yesterday);
  yesterdayQuery = applyStoreIdsFilter(yesterdayQuery, storeIds);
  const { data: yesterdayRows, error: yesterdayError } = await yesterdayQuery;
  throwIfSupabaseError(yesterdayError);

  const previousDayTotalRef = sumDailyRows(yesterdayRows ?? []).totalRef;
  const dayOverDayChangePercent =
    previousDayTotalRef > 0
      ? ((todayTotals.totalRef - previousDayTotalRef) / previousDayTotalRef) * 100
      : null;

  let customersQuery = supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .in("type", ["cliente", "ambos"]);
  customersQuery = applyStoreIdsFilter(customersQuery, storeIds);
  const { count: activeCustomers, error: customersError } = await customersQuery;
  throwIfSupabaseError(customersError);

  return {
    activeCustomers: activeCustomers ?? 0,
    dayOverDayChangePercent,
    lowStockCount: lowStockCount ?? 0,
    pendingSalesCount: pendingSalesCount ?? 0,
    previousDayTotalRef,
    salesCount: todayTotals.salesCount,
    totalRef: todayTotals.totalRef,
    totalVes: todayTotals.totalVes,
  };
}

export async function getDashboardMetrics(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: DashboardQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await getDashboardClient(options);

  let salesQuery = supabase
    .from("sales")
    .select("id, total_ref, total_ves, paid_ves")
    .in("status", [...METRICS_SALE_STATUSES]);
  salesQuery = applyStoreIdsFilter(salesQuery, storeIds);
  salesQuery = applyCreatedAtRange(salesQuery, from, to);

  const { data: sales, error: salesError } = await salesQuery;
  throwIfSupabaseError(salesError);

  const salesRows = sales ?? [];
  const saleIds = salesRows.map((sale) => sale.id);
  let unitsSold = 0;

  if (saleIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("sale_items")
      .select("quantity")
      .in("sale_id", saleIds);

    throwIfSupabaseError(itemsError);
    unitsSold = (items ?? []).reduce((total, item) => total + item.quantity, 0);
  }

  const totalRef = salesRows.reduce((total, sale) => total + Number(sale.total_ref), 0);
  const totalVes = salesRows.reduce((total, sale) => total + Number(sale.total_ves), 0);
  const paidVes = salesRows.reduce((total, sale) => total + Number(sale.paid_ves), 0);

  return {
    from,
    paidVes,
    pendingVes: totalVes - paidVes,
    salesCount: salesRows.length,
    to,
    totalRef,
    totalVes,
    unitsSold,
  };
}

type DbSaleWithCustomer = DbSale & {
  contacts: { name: string } | { name: string }[] | null;
};

function mapRecentSale(row: DbSaleWithCustomer, storeName?: string) {
  const contact = row.contacts;
  const customerName = Array.isArray(contact) ? contact[0]?.name : contact?.name;

  return {
    createdAt: row.created_at,
    customerName: customerName ?? "Sin cliente",
    id: row.id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    storeId: row.store_id,
    storeName,
    totalRef: Number(row.total_ref),
  };
}

export async function getDashboardSalesTrend(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: DashboardQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await getDashboardClient(options);

  let query = supabase
    .from("daily_sales_summary")
    .select("sale_date, sales_count, total_ref, total_ves, paid_ves")
    .order("sale_date", { ascending: true })
    .limit(2000);
  query = applyStoreIdsFilter(query, storeIds);

  if (from) {
    query = query.gte("sale_date", from);
  }

  if (to) {
    query = query.lte("sale_date", to);
  }

  const { data, error } = await query;
  throwIfSupabaseError(error);

  const byDate = new Map<
    string,
    { paidVes: number; saleDate: string; salesCount: number; totalRef: number; totalVes: number }
  >();

  for (const row of data ?? []) {
    const saleDate = row.sale_date;
    const current = byDate.get(saleDate) ?? {
      paidVes: 0,
      saleDate,
      salesCount: 0,
      totalRef: 0,
      totalVes: 0,
    };
    current.salesCount += Number(row.sales_count ?? 0);
    current.totalRef += Number(row.total_ref ?? 0);
    current.totalVes += Number(row.total_ves ?? 0);
    current.paidVes += Number(row.paid_ves ?? 0);
    byDate.set(saleDate, current);
  }

  return {
    items: [...byDate.values()].sort((first, second) =>
      first.saleDate.localeCompare(second.saleDate),
    ),
  };
}

export async function getRecentSales(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: DashboardQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await getDashboardClient(options);

  let query = supabase
    .from("sales")
    .select("id, invoice_number, created_at, status, total_ref, store_id, contacts(name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false });
  query = applyStoreIdsFilter(query, storeIds);

  const { data, error, count } = await query.range(skip, skip + limit - 1);
  throwIfSupabaseError(error);

  const rows = (data ?? []) as DbSaleWithCustomer[];
  const saleStoreIds = [
    ...new Set(rows.map((row) => row.store_id).filter((id): id is string => Boolean(id))),
  ];

  let storeNames = new Map<string, string>();
  if (saleStoreIds.length > 0) {
    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("id, name")
      .in("id", saleStoreIds);
    throwIfSupabaseError(storesError);
    storeNames = new Map((stores ?? []).map((store) => [store.id, store.name]));
  }

  return {
    items: rows.map((row) =>
      mapRecentSale(row, row.store_id ? storeNames.get(row.store_id) : undefined),
    ),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getDashboardLowStock(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: DashboardQueryOptions,
): Promise<PaginatedList<ReturnType<typeof mapLowStockProduct>>> {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await getDashboardClient(options);

  let query = supabase
    .from("low_stock_products")
    .select("id, name, sku, current_stock, min_stock, store_id", { count: "exact" })
    .order("name", { ascending: true });
  query = applyStoreIdsFilter(query, storeIds);

  const { data, error, count } = await query.range(skip, skip + limit - 1);
  throwIfSupabaseError(error);

  const rows = (data ?? []) as DbProduct[];
  const productStoreIds = [
    ...new Set(rows.map((row) => row.store_id).filter((id): id is string => Boolean(id))),
  ];

  let storeNames = new Map<string, string>();
  if (productStoreIds.length > 0) {
    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("id, name")
      .in("id", productStoreIds);
    throwIfSupabaseError(storesError);
    storeNames = new Map((stores ?? []).map((store) => [store.id, store.name]));
  }

  return {
    items: rows.map((row) =>
      mapLowStockProduct({
        ...row,
        store_name: row.store_id ? storeNames.get(row.store_id) : undefined,
      }),
    ),
    limit,
    skip,
    total: count ?? 0,
  };
}
