import { paginateList, parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapNullableString } from "@/lib/supabase/mappers";
import { listCountOptions } from "@/modules/products/services/listRange";

import { applyCreatedAtCaracasRange, toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import { fetchAllRows, fetchAllRowsByIds, fetchCountedPage } from "./reportPagination";
import {
  buildDailySalesSeries,
  buildGrossProfitSeries,
  buildPurchasesSeries,
  parseReportSeriesParams,
  resolvePurchasesReportStatuses,
  resolveReportSeriesRequest,
  seriesFetchRange,
  type DailySalesSeries,
  type GrossProfitSeries,
  type PurchasesSeries,
  type ReportSeriesRange,
} from "./reportSeries";
import { normalizeStoreIds } from "./storeScope";

export type ReportQueryOptions = {
  /** Usa service role (necesario para superadmin / multi-tienda). */
  useAdmin?: boolean;
};

async function getReportsClient(options?: ReportQueryOptions) {
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

type DbPurchase = {
  created_at: string;
  discount_ref: number | string;
  id: string;
  paid_ves: number | string;
  purchase_number: string;
  ref_rate_ves: number | string;
  status: string;
  subtotal_ref: number | string;
  supplier_id: string;
  tax_ref: number | string;
  total_ref: number | string;
  total_ves: number | string;
  user_id: string | null;
};

type DbContact = {
  id: string;
  name: string;
};

function applyDateColumnRange<T extends { gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(
  query: T,
  column: string,
  from: string | null,
  to: string | null,
) {
  let next = query;

  if (from) {
    next = next.gte(column, from);
  }

  if (to) {
    next = next.lte(column, to);
  }

  return next;
}

function applyCreatedAtRange<
  T extends { gte: (col: string, val: string) => T; lt: (col: string, val: string) => T },
>(query: T, from: string | null, to: string | null) {
  return applyCreatedAtCaracasRange(query, from, to);
}

function mapProduct(row: DbProduct) {
  return {
    categoryId: row.category_id ?? "",
    currentCostRef: Number(row.current_cost_ref),
    currentStock: row.current_stock,
    id: row.id,
    imageUrl: mapNullableString(row.image_url),
    isActive: row.is_active,
    minStock: row.min_stock,
    name: row.name,
    salePriceRef: Number(row.sale_price_ref),
    sku: row.sku,
  };
}

function mapDailySalesRow(row: {
  paid_ves: number | string;
  sale_date: string;
  sales_count: number;
  total_ref: number | string;
  total_ves: number | string;
}) {
  return {
    paidVes: Number(row.paid_ves),
    saleDate: row.sale_date,
    salesCount: row.sales_count,
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
  };
}

function mapGrossProfitRow(row: {
  cost_ref: number | string;
  gross_profit_ref: number | string;
  revenue_ref: number | string;
  sale_date: string;
}) {
  return {
    costRef: Number(row.cost_ref),
    grossProfitRef: Number(row.gross_profit_ref),
    revenueRef: Number(row.revenue_ref),
    saleDate: row.sale_date,
  };
}

function mapProductProfitabilityRow(row: {
  cost_ref: number | string;
  gross_profit_ref: number | string;
  name: string;
  product_id: string;
  revenue_ref: number | string;
  sku: string;
  units_sold: number | string;
}) {
  return {
    costRef: Number(row.cost_ref),
    grossProfitRef: Number(row.gross_profit_ref),
    name: row.name,
    productId: row.product_id,
    revenueRef: Number(row.revenue_ref),
    sku: row.sku,
    unitsSold: Number(row.units_sold),
  };
}

function mapCustomerPurchaseRow(row: {
  customer_id: string;
  last_purchase_at: string | null;
  name: string;
  pending_ves: number | string;
  sales_count: number;
  total_ref: number | string;
  total_ves: number | string;
}) {
  return {
    customerId: row.customer_id,
    lastPurchaseAt: row.last_purchase_at ?? undefined,
    name: row.name,
    pendingVes: Number(row.pending_ves),
    salesCount: row.sales_count,
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
  };
}

function mapSupplierPurchaseRow(row: {
  last_purchase_at: string | null;
  name: string;
  pending_ves: number | string;
  purchases_count: number;
  supplier_id: string;
  total_ref: number | string;
  total_ves: number | string;
}) {
  return {
    lastPurchaseAt: row.last_purchase_at ?? undefined,
    name: row.name,
    pendingVes: Number(row.pending_ves),
    purchasesCount: row.purchases_count,
    supplierId: row.supplier_id,
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
  };
}

function mapStockCardRow(row: {
  created_at: string;
  id: string;
  product_id: string;
  product_name: string;
  purchase_id: string | null;
  quantity_delta: number;
  reason: string | null;
  sale_id: string | null;
  sku: string;
  stock_after: number;
  type: string;
}) {
  return {
    createdAt: row.created_at,
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    purchaseId: mapNullableString(row.purchase_id),
    quantityDelta: row.quantity_delta,
    reason: mapNullableString(row.reason),
    saleId: mapNullableString(row.sale_id),
    sku: row.sku,
    stockAfter: row.stock_after,
    type: row.type,
  };
}

function mapPurchaseListItem(row: DbPurchase, supplier?: DbContact, itemsCount = 0) {
  return {
    createdAt: row.created_at,
    discountRef: Number(row.discount_ref),
    id: row.id,
    itemsCount,
    paidVes: Number(row.paid_ves),
    purchaseNumber: row.purchase_number,
    refRateVes: Number(row.ref_rate_ves),
    status: row.status,
    subtotalRef: Number(row.subtotal_ref),
    supplier: supplier
      ? {
          id: supplier.id,
          name: supplier.name,
        }
      : undefined,
    supplierId: row.supplier_id,
    taxRef: Number(row.tax_ref),
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
    userId: row.user_id ?? "",
  };
}

async function listView<T>(
  view: string,
  searchParams: URLSearchParams,
  mapRow: (row: never) => T,
  options: {
    dateColumn?: string;
    order?: { ascending?: boolean; column: string };
    productIdColumn?: string;
    storeIds: string[];
    useAdmin?: boolean;
  },
): Promise<PaginatedList<T>> {
  const { limit, skip } = parsePagination(searchParams);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const productId = searchParams.get("productId");
  const supabase = await getReportsClient(options);

  const buildQuery = (head: boolean) => {
    let query = supabase.from(view).select("*", listCountOptions(head));
    query = applyStoreIdsFilter(query, options.storeIds);

    if (options.dateColumn) {
      query = applyDateColumnRange(query, options.dateColumn, from, to);
    }

    if (options.productIdColumn && productId) {
      query = query.eq(options.productIdColumn, productId);
    }

    return query;
  };

  const page = await fetchCountedPage<unknown>({
    count: () => buildQuery(true),
    rows: () => {
      const query = buildQuery(false);
      const ordered = options.order
        ? query.order(options.order.column, { ascending: options.order.ascending ?? true })
        : query;

      return ordered.range(skip, skip + limit - 1);
    },
  });

  return {
    items: page.rows.map((row) => mapRow(row as never)),
    limit,
    skip,
    total: page.total,
  };
}

type DbDailySalesDayRow = {
  paid_ves: number | string;
  sale_date: string;
  sales_count: number | string;
  store_id: string;
  total_ref: number | string;
  total_ves: number | string;
};

type DbGrossProfitDayRow = {
  cost_ref: number | string;
  gross_profit_ref: number | string;
  revenue_ref: number | string;
  sale_date: string;
  store_id: string;
};

/**
 * Todas las filas diarias de una vista de resumen en el rango, leídas en
 * páginas (2 años son > 1.000 filas con varias tiendas). `(store_id,
 * sale_date)` es único en la vista: da un orden estable entre páginas.
 */
async function fetchSummaryDayRows<Row extends { sale_date: string; store_id: string }>(
  view: "daily_sales_summary" | "gross_profit_summary",
  columns: string,
  storeIds: string[],
  range: ReportSeriesRange,
  options?: ReportQueryOptions,
) {
  const supabase = await getReportsClient(options);

  return fetchAllRows<Row>(
    async (rangeFrom, rangeTo) => {
      let query = supabase.from(view).select(columns, { count: "exact" });
      query = applyStoreIdsFilter(query, storeIds);
      query = applyDateColumnRange(query, "sale_date", range.from, range.to);

      const { count, data, error, status } = await query
        .order("sale_date", { ascending: true })
        .order("store_id", { ascending: true })
        .range(rangeFrom, rangeTo);

      return { count, data: data as unknown as Row[] | null, error, status };
    },
    { getKey: (row) => `${row.store_id}|${row.sale_date}` },
  );
}

/**
 * Ventas diarias. Con `from` + `to` y (`groupBy` o `compare`) añade `series`:
 * la serie completa del rango agrupada por día/semana/mes y, con `compare=1`,
 * el periodo anterior. La tabla (`items`) no cambia.
 */
export async function getDailySalesReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
): Promise<PaginatedList<ReturnType<typeof mapDailySalesRow>> & { series?: DailySalesSeries }> {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const seriesRequest = resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
  const list = await listView("daily_sales_summary", searchParams, mapDailySalesRow, {
    dateColumn: "sale_date",
    order: { column: "sale_date", ascending: false },
    storeIds,
    useAdmin: options?.useAdmin,
  });

  if (!seriesRequest) {
    return list;
  }

  const rows = await fetchSummaryDayRows<DbDailySalesDayRow>(
    "daily_sales_summary",
    "store_id, sale_date, sales_count, total_ref, total_ves, paid_ves",
    storeIds,
    seriesFetchRange(seriesRequest),
    options,
  );

  return {
    ...list,
    series: buildDailySalesSeries(
      seriesRequest,
      rows.map((row) => ({
        day: row.sale_date,
        values: {
          count: Number(row.sales_count),
          paidVes: Number(row.paid_ves),
          totalRef: Number(row.total_ref),
          totalVes: Number(row.total_ves),
        },
      })),
    ),
  };
}

/** Ganancia bruta. `series` con la misma regla que `getDailySalesReport`. */
export async function getGrossProfitReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
): Promise<PaginatedList<ReturnType<typeof mapGrossProfitRow>> & { series?: GrossProfitSeries }> {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const seriesRequest = resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
  const list = await listView("gross_profit_summary", searchParams, mapGrossProfitRow, {
    dateColumn: "sale_date",
    order: { column: "sale_date", ascending: false },
    storeIds,
    useAdmin: options?.useAdmin,
  });

  if (!seriesRequest) {
    return list;
  }

  const rows = await fetchSummaryDayRows<DbGrossProfitDayRow>(
    "gross_profit_summary",
    "store_id, sale_date, revenue_ref, cost_ref, gross_profit_ref",
    storeIds,
    seriesFetchRange(seriesRequest),
    options,
  );

  return {
    ...list,
    series: buildGrossProfitSeries(
      seriesRequest,
      rows.map((row) => ({
        day: row.sale_date,
        values: {
          costRef: Number(row.cost_ref),
          grossProfitRef: Number(row.gross_profit_ref),
          revenueRef: Number(row.revenue_ref),
        },
      })),
    ),
  };
}

export async function getProductProfitabilityReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  return listView("product_profitability", searchParams, mapProductProfitabilityRow, {
    order: { column: "gross_profit_ref", ascending: false },
    storeIds: normalizeStoreIds(storeIdOrIds),
    useAdmin: options?.useAdmin,
  });
}

export async function getLowStockReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await getReportsClient(options);

  const buildQuery = (head: boolean) => {
    let query = supabase.from("low_stock_products").select("*", listCountOptions(head));
    query = applyStoreIdsFilter(query, storeIds);

    return query;
  };

  const page = await fetchCountedPage<DbProduct>({
    count: () => buildQuery(true),
    rows: () => buildQuery(false).order("name", { ascending: true }).range(skip, skip + limit - 1),
  });

  return {
    items: page.rows.map(mapProduct),
    limit,
    skip,
    total: page.total,
  };
}

export async function getStockCard(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  return listView("stock_card", searchParams, mapStockCardRow, {
    order: { column: "created_at", ascending: false },
    productIdColumn: "product_id",
    storeIds: normalizeStoreIds(storeIdOrIds),
    useAdmin: options?.useAdmin,
  });
}

export async function getCustomerPurchasesReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  return listView("customer_purchase_summary", searchParams, mapCustomerPurchaseRow, {
    order: { column: "total_ves", ascending: false },
    storeIds: normalizeStoreIds(storeIdOrIds),
    useAdmin: options?.useAdmin,
  });
}

export async function getSupplierPurchasesReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  return listView("supplier_purchase_summary", searchParams, mapSupplierPurchaseRow, {
    order: { column: "total_ves", ascending: false },
    storeIds: normalizeStoreIds(storeIdOrIds),
    useAdmin: options?.useAdmin,
  });
}

type DbTopProductItem = {
  id: string;
  product_id: string;
  quantity: number;
  subtotal_ref: number | string;
};

type DbTopCustomerSale = {
  created_at: string;
  customer_id: string;
  id: string;
  total_ref: number | string;
  total_ves: number | string;
};

type ReportsClient = Awaited<ReturnType<typeof getReportsClient>>;

/**
 * Todas las ventas que cuentan (ni canceladas ni devueltas) del rango, leídas
 * en páginas: PostgREST corta cada respuesta en 1.000 filas. Van en orden de
 * creación, con `id` (único) de desempate para que no cambie entre páginas.
 */
async function fetchRangeSales<Row extends { id: string }>(
  supabase: ReportsClient,
  columns: string,
  storeIds: string[],
  from: string | null,
  to: string | null,
) {
  return fetchAllRows<Row>(
    async (rangeFrom, rangeTo) => {
      let query = supabase
        .from("sales")
        .select(columns, { count: "exact" })
        .in("status", ["borrador", "pagada", "pendiente_pago"]);
      query = applyStoreIdsFilter(query, storeIds);
      query = applyCreatedAtRange(query, from, to);

      const { count, data, error, status } = await query
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);

      return { count, data: data as unknown as Row[] | null, error, status };
    },
    { getKey: (sale) => sale.id },
  );
}

export async function getTopProductsReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await getReportsClient(options);

  const sales = await fetchRangeSales<{ created_at: string; id: string }>(
    supabase,
    "id, created_at",
    storeIds,
    from,
    to,
  );
  const saleIds = sales.map((sale) => sale.id);

  if (saleIds.length === 0) {
    return paginateList([], searchParams);
  }

  // Las líneas se piden por lotes de ventas: todos los ids en una URL dan "URI too long".
  const items = await fetchAllRowsByIds<DbTopProductItem>(
    saleIds,
    async (saleIdChunk, rangeFrom, rangeTo) =>
      supabase
        .from("sale_items")
        .select("id, product_id, quantity, subtotal_ref", { count: "exact" })
        .in("sale_id", saleIdChunk)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo),
    { getKey: (item) => item.id },
  );

  const totals = new Map<string, { revenueRef: number; unitsSold: number }>();

  for (const item of items) {
    const current = totals.get(item.product_id) ?? { revenueRef: 0, unitsSold: 0 };
    totals.set(item.product_id, {
      revenueRef: current.revenueRef + Number(item.subtotal_ref),
      unitsSold: current.unitsSold + item.quantity,
    });
  }

  const productIds = [...totals.keys()];

  if (productIds.length === 0) {
    return paginateList([], searchParams);
  }

  const products = await fetchAllRowsByIds<{ id: string; name: string; sku: string }>(
    productIds,
    async (productIdChunk, rangeFrom, rangeTo) =>
      supabase
        .from("products")
        .select("id, sku, name", { count: "exact" })
        .in("id", productIdChunk)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo),
    { getKey: (product) => product.id },
  );

  const productById = new Map(products.map((product) => [product.id, product]));

  const ranked = productIds
    .map((productId) => ({
      name: productById.get(productId)?.name ?? "",
      productId,
      revenueRef: totals.get(productId)?.revenueRef ?? 0,
      sku: productById.get(productId)?.sku ?? "",
      unitsSold: totals.get(productId)?.unitsSold ?? 0,
    }))
    .filter((item) => item.unitsSold > 0)
    .sort((first, second) => second.unitsSold - first.unitsSold);

  return paginateList(ranked, searchParams);
}

export async function getTopCustomersReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await getReportsClient(options);

  const sales = await fetchRangeSales<DbTopCustomerSale>(
    supabase,
    "id, created_at, customer_id, total_ref, total_ves",
    storeIds,
    from,
    to,
  );

  const totals = new Map<
    string,
    { salesCount: number; totalRef: number; totalVes: number }
  >();

  for (const sale of sales) {
    const current = totals.get(sale.customer_id) ?? { salesCount: 0, totalRef: 0, totalVes: 0 };
    totals.set(sale.customer_id, {
      salesCount: current.salesCount + 1,
      totalRef: current.totalRef + Number(sale.total_ref),
      totalVes: current.totalVes + Number(sale.total_ves),
    });
  }

  const customerIds = [...totals.keys()];

  if (customerIds.length === 0) {
    return paginateList([], searchParams);
  }

  const contacts = await fetchAllRowsByIds<DbContact>(
    customerIds,
    async (customerIdChunk, rangeFrom, rangeTo) =>
      supabase
        .from("contacts")
        .select("id, name", { count: "exact" })
        .in("id", customerIdChunk)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo),
    { getKey: (contact) => contact.id },
  );

  const nameById = new Map(contacts.map((contact) => [contact.id, contact.name]));

  const ranked = customerIds
    .map((customerId) => ({
      customerId,
      name: nameById.get(customerId) ?? "",
      salesCount: totals.get(customerId)?.salesCount ?? 0,
      totalRef: totals.get(customerId)?.totalRef ?? 0,
      totalVes: totals.get(customerId)?.totalVes ?? 0,
    }))
    .filter((item) => item.salesCount > 0)
    .sort((first, second) => second.totalVes - first.totalVes);

  return paginateList(ranked, searchParams);
}

type DbPurchaseSeriesRow = {
  created_at: string;
  id: string;
  total_ref: number | string;
  total_ves: number | string;
};

/**
 * Compras por periodo. La tabla (`items`) lista las compras paginadas. Con
 * `from` + `to` y (`groupBy` o `compare`) añade `series` en el mismo endpoint:
 * total y nº de compras por periodo, respetando `supplierId`.
 *
 * Tabla y serie aplican la MISMA regla de estados (`status`): por defecto sin
 * canceladas ni devueltas (igual que `supplier_purchase_summary`), `status=all`
 * para todas o un estado concreto. Así el total de la serie es la suma de la
 * tabla del rango.
 */
export async function getPurchasesReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
  options?: ReportQueryOptions,
) {
  const storeIds = normalizeStoreIds(storeIdOrIds);
  const seriesRequest = resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
  const from = searchParams.get("from");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");
  const statuses = [...resolvePurchasesReportStatuses(searchParams)];
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await getReportsClient(options);

  const buildQuery = (head: boolean) => {
    let query = supabase
      .from("purchases")
      .select("*", listCountOptions(head))
      .in("status", statuses);
    query = applyStoreIdsFilter(query, storeIds);

    if (supplierId) {
      query = query.eq("supplier_id", supplierId);
    }

    return applyCreatedAtRange(query, from, to);
  };

  const page = await fetchCountedPage<DbPurchase>({
    count: () => buildQuery(true),
    rows: () =>
      buildQuery(false).order("created_at", { ascending: false }).range(skip, skip + limit - 1),
  });

  const purchaseRows = page.rows;
  const purchaseIds = purchaseRows.map((purchase) => purchase.id);
  const supplierIds = [...new Set(purchaseRows.map((purchase) => purchase.supplier_id))];

  let itemsCountByPurchase = new Map<string, number>();
  let suppliersById = new Map<string, DbContact>();

  if (purchaseIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("purchase_items")
      .select("purchase_id")
      .in("purchase_id", purchaseIds);

    throwIfSupabaseError(itemsError);

    itemsCountByPurchase = (items ?? []).reduce((map, item) => {
      map.set(item.purchase_id, (map.get(item.purchase_id) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
  }

  if (supplierIds.length > 0) {
    const { data: suppliers, error: suppliersError } = await supabase
      .from("contacts")
      .select("id, name")
      .in("id", supplierIds);

    throwIfSupabaseError(suppliersError);
    suppliersById = new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier as DbContact]));
  }

  const list: PaginatedList<ReturnType<typeof mapPurchaseListItem>> & { series?: PurchasesSeries } =
    {
      items: purchaseRows.map((row) =>
        mapPurchaseListItem(
          row,
          suppliersById.get(row.supplier_id),
          itemsCountByPurchase.get(row.id) ?? 0,
        ),
      ),
      limit,
      skip,
      total: page.total,
    };

  if (!seriesRequest) {
    return list;
  }

  const fetchRange = seriesFetchRange(seriesRequest);
  const seriesRows = await fetchAllRows<DbPurchaseSeriesRow>(
    async (rangeFrom, rangeTo) => {
      let query = supabase
        .from("purchases")
        .select("id, created_at, total_ref, total_ves", { count: "exact" })
        .in("status", statuses);
      query = applyStoreIdsFilter(query, storeIds);

      if (supplierId) {
        query = query.eq("supplier_id", supplierId);
      }

      query = applyCreatedAtRange(query, fetchRange.from, fetchRange.to);

      // `id` es único: el orden no cambia entre páginas.
      const { count, data, error, status } = await query
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);

      return { count, data: data as DbPurchaseSeriesRow[] | null, error, status };
    },
    { getKey: (row) => row.id },
  );

  return {
    ...list,
    series: buildPurchasesSeries(
      seriesRequest,
      seriesRows.map((row) => ({
        day: toCaracasDateKey(row.created_at),
        values: { count: 1, totalRef: Number(row.total_ref), totalVes: Number(row.total_ves) },
      })),
    ),
  };
}

export { getFxDepreciationReport } from "./fxDepreciationReport.server";
export { getPaymentMethodsReport } from "./paymentMethodsReport.server";
