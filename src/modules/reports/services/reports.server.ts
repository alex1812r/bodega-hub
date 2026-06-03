import { paginateList, parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapNullableString } from "@/lib/supabase/mappers";

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
  options?: {
    dateColumn?: string;
    order?: { ascending?: boolean; column: string };
    productIdColumn?: string;
  },
): Promise<PaginatedList<T>> {
  const { limit, skip } = parsePagination(searchParams);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const productId = searchParams.get("productId");
  const supabase = await createRouteSupabaseClient();

  let query = supabase.from(view).select("*", { count: "exact" });

  if (options?.dateColumn) {
    query = applyDateColumnRange(query, options.dateColumn, from, to);
  }

  if (options?.productIdColumn && productId) {
    query = query.eq(options.productIdColumn, productId);
  }

  if (options?.order) {
    query = query.order(options.order.column, { ascending: options.order.ascending ?? true });
  }

  const { data, error, count } = await query.range(skip, skip + limit - 1);
  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapRow(row as never)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getDailySalesReport(searchParams: URLSearchParams) {
  return listView("daily_sales_summary", searchParams, mapDailySalesRow, {
    dateColumn: "sale_date",
    order: { column: "sale_date", ascending: false },
  });
}

export async function getGrossProfitReport(searchParams: URLSearchParams) {
  return listView("gross_profit_summary", searchParams, mapGrossProfitRow, {
    dateColumn: "sale_date",
    order: { column: "sale_date", ascending: false },
  });
}

export async function getProductProfitabilityReport(searchParams: URLSearchParams) {
  return listView("product_profitability", searchParams, mapProductProfitabilityRow, {
    order: { column: "gross_profit_ref", ascending: false },
  });
}

export async function getLowStockReport(searchParams: URLSearchParams) {
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await createRouteSupabaseClient();

  const { data, error, count } = await supabase
    .from("low_stock_products")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapProduct(row as DbProduct)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getStockCard(searchParams: URLSearchParams) {
  return listView("stock_card", searchParams, mapStockCardRow, {
    order: { column: "created_at", ascending: false },
    productIdColumn: "product_id",
  });
}

export async function getCustomerPurchasesReport(searchParams: URLSearchParams) {
  return listView("customer_purchase_summary", searchParams, mapCustomerPurchaseRow, {
    order: { column: "total_ves", ascending: false },
  });
}

export async function getSupplierPurchasesReport(searchParams: URLSearchParams) {
  return listView("supplier_purchase_summary", searchParams, mapSupplierPurchaseRow, {
    order: { column: "total_ves", ascending: false },
  });
}

export async function getTopProductsReport(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await createRouteSupabaseClient();

  let salesQuery = supabase
    .from("sales")
    .select("id")
    .in("status", ["borrador", "pagada", "pendiente_pago"]);

  salesQuery = applyCreatedAtRange(salesQuery, from, to);

  const { data: sales, error: salesError } = await salesQuery;
  throwIfSupabaseError(salesError);

  const saleIds = (sales ?? []).map((sale) => sale.id);

  if (saleIds.length === 0) {
    return paginateList([], searchParams);
  }

  const { data: items, error: itemsError } = await supabase
    .from("sale_items")
    .select("product_id, quantity, subtotal_ref")
    .in("sale_id", saleIds);

  throwIfSupabaseError(itemsError);

  const totals = new Map<string, { revenueRef: number; unitsSold: number }>();

  for (const item of items ?? []) {
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

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, sku")
    .in("id", productIds);

  throwIfSupabaseError(productsError);

  const skuById = new Map((products ?? []).map((product) => [product.id, product.sku]));

  const ranked = productIds
    .map((productId) => ({
      productId,
      revenueRef: totals.get(productId)?.revenueRef ?? 0,
      sku: skuById.get(productId) ?? "",
      unitsSold: totals.get(productId)?.unitsSold ?? 0,
    }))
    .filter((item) => item.unitsSold > 0)
    .sort((first, second) => second.unitsSold - first.unitsSold);

  return paginateList(ranked, searchParams);
}

export async function getTopCustomersReport(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const supabase = await createRouteSupabaseClient();

  let salesQuery = supabase
    .from("sales")
    .select("customer_id, total_ref, total_ves")
    .in("status", ["borrador", "pagada", "pendiente_pago"]);

  salesQuery = applyCreatedAtRange(salesQuery, from, to);

  const { data: sales, error: salesError } = await salesQuery;
  throwIfSupabaseError(salesError);

  const totals = new Map<
    string,
    { salesCount: number; totalRef: number; totalVes: number }
  >();

  for (const sale of sales ?? []) {
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

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id, name")
    .in("id", customerIds);

  throwIfSupabaseError(contactsError);

  const nameById = new Map((contacts ?? []).map((contact) => [contact.id, contact.name]));

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

export async function getPurchasesReport(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");
  const { limit, skip } = parsePagination(searchParams);
  const supabase = await createRouteSupabaseClient();

  let query = supabase.from("purchases").select("*", { count: "exact" });

  if (supplierId) {
    query = query.eq("supplier_id", supplierId);
  }

  query = applyCreatedAtRange(query, from, to);
  query = query.order("created_at", { ascending: false });

  const { data: purchases, error, count } = await query.range(skip, skip + limit - 1);
  throwIfSupabaseError(error);

  const purchaseRows = purchases ?? [];
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

  return {
    items: purchaseRows.map((row) =>
      mapPurchaseListItem(
        row as DbPurchase,
        suppliersById.get(row.supplier_id),
        itemsCountByPurchase.get(row.id) ?? 0,
      ),
    ),
    limit,
    skip,
    total: count ?? 0,
  };
}
