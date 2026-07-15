import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

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
};

const METRICS_SALE_STATUSES = ["borrador", "pagada", "pendiente_pago"] as const;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function mapLowStockProduct(row: DbProduct) {
  return {
    currentStock: row.current_stock,
    id: row.id,
    minStock: row.min_stock,
    name: row.name,
    sku: row.sku,
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

export async function getDashboardSummary() {
  const supabase = await createRouteSupabaseClient();
  const today = todayIsoDate();

  const { data: todayRow, error: todayError } = await supabase
    .from("daily_sales_summary")
    .select("sales_count, total_ref, total_ves")
    .eq("sale_date", today)
    .maybeSingle();

  throwIfSupabaseError(todayError);

  const { count: lowStockCount, error: lowStockError } = await supabase
    .from("low_stock_products")
    .select("id", { count: "exact", head: true });

  throwIfSupabaseError(lowStockError);

  const { count: pendingSalesCount, error: pendingError } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendiente_pago");

  throwIfSupabaseError(pendingError);

  const yesterday = shiftIsoDate(today, -1);
  const { data: yesterdayRow, error: yesterdayError } = await supabase
    .from("daily_sales_summary")
    .select("total_ref")
    .eq("sale_date", yesterday)
    .maybeSingle();

  throwIfSupabaseError(yesterdayError);

  const totalRef = Number(todayRow?.total_ref ?? 0);
  const previousDayTotalRef = Number(yesterdayRow?.total_ref ?? 0);
  const dayOverDayChangePercent =
    previousDayTotalRef > 0
      ? ((totalRef - previousDayTotalRef) / previousDayTotalRef) * 100
      : null;

  const { count: activeCustomers, error: customersError } = await supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .in("type", ["cliente", "ambos"]);

  throwIfSupabaseError(customersError);

  return {
    activeCustomers: activeCustomers ?? 0,
    dayOverDayChangePercent,
    lowStockCount: lowStockCount ?? 0,
    pendingSalesCount: pendingSalesCount ?? 0,
    previousDayTotalRef,
    salesCount: todayRow?.sales_count ?? 0,
    totalRef,
    totalVes: Number(todayRow?.total_ves ?? 0),
  };
}

export async function getDashboardMetrics(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await createRouteSupabaseClient();

  let salesQuery = supabase
    .from("sales")
    .select("id, total_ref, total_ves, paid_ves")
    .in("status", [...METRICS_SALE_STATUSES]);

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

function mapRecentSale(row: DbSaleWithCustomer) {
  const contact = row.contacts;
  const customerName = Array.isArray(contact)
    ? contact[0]?.name
    : contact?.name;

  return {
    createdAt: row.created_at,
    customerName: customerName ?? "Sin cliente",
    id: row.id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    totalRef: Number(row.total_ref),
  };
}

export async function getDashboardSalesTrend(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await createRouteSupabaseClient();

  let query = supabase
    .from("daily_sales_summary")
    .select("sale_date, sales_count, total_ref, total_ves, paid_ves")
    .order("sale_date", { ascending: true })
    .limit(400);

  if (from) {
    query = query.gte("sale_date", from);
  }

  if (to) {
    query = query.lte("sale_date", to);
  }

  const { data, error } = await query;
  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => ({
      paidVes: Number(row.paid_ves),
      saleDate: row.sale_date,
      salesCount: row.sales_count,
      totalRef: Number(row.total_ref),
      totalVes: Number(row.total_ves),
    })),
  };
}

export async function getRecentSales(searchParams: URLSearchParams) {
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await createRouteSupabaseClient();

  const { data, error, count } = await supabase
    .from("sales")
    .select("id, invoice_number, created_at, status, total_ref, contacts(name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapRecentSale(row as DbSaleWithCustomer)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getDashboardLowStock(
  searchParams: URLSearchParams,
): Promise<PaginatedList<ReturnType<typeof mapLowStockProduct>>> {
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await createRouteSupabaseClient();

  const { data, error, count } = await supabase
    .from("low_stock_products")
    .select("id, name, sku, current_stock, min_stock", { count: "exact" })
    .order("name", { ascending: true })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapLowStockProduct(row as DbProduct)),
    limit,
    skip,
    total: count ?? 0,
  };
}
