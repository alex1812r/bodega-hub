import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import { mapContact, type DbContactRow } from "@/lib/supabase/mappers/contacts";
import {
  mapPayment,
  mapPurchase,
  mapPurchaseItem,
  mapStockMovement,
  type DbPaymentRow,
  type DbPurchaseItemRow,
  type DbPurchaseRow,
  type DbStockMovementRow,
} from "@/lib/supabase/mappers/transactions";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

import type { PurchaseInput } from "./purchases.mock-server";

const contactSelect =
  "id, name, type, email, phone, address, tax_id, notes, is_active, created_at, updated_at";

const productSelect =
  "id, name, sku, category_id, current_cost_ref, current_stock, min_stock, image_url, is_active, sale_price_ref";

const purchaseSelect = `
  id,
  purchase_number,
  supplier_id,
  user_id,
  ref_rate_ves,
  subtotal_ref,
  discount_ref,
  tax_ref,
  total_ref,
  total_ves,
  paid_ves,
  status,
  notes,
  created_at,
  updated_at,
  supplier:contacts(${contactSelect}),
  purchase_items(count)
`;

const purchaseDetailSelect = `
  id,
  purchase_number,
  supplier_id,
  user_id,
  ref_rate_ves,
  subtotal_ref,
  discount_ref,
  tax_ref,
  total_ref,
  total_ves,
  paid_ves,
  status,
  notes,
  created_at,
  updated_at,
  supplier:contacts(${contactSelect}),
  purchase_items(
    product_id,
    purchase_id,
    quantity,
    unit_cost_ref,
    unit_cost_ves,
    subtotal_ref,
    subtotal_ves,
    product:products(${productSelect})
  )
`;

const paymentSelect =
  "id, direction, sale_id, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref, ref_rate_ves, bank_name, reference_code, created_at";

type PurchaseListRow = DbPurchaseRow & {
  purchase_items?: Array<{ count: number }>;
  supplier?: DbContactRow | null;
};

type PurchaseDetailRow = DbPurchaseRow & {
  purchase_items?: DbPurchaseItemRow[];
  supplier?: DbContactRow | null;
};

function toRpcItems(items: NonNullable<PurchaseInput["items"]>) {
  return items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_cost_ref: item.unitCostRef,
    ...(item.supplierSku ? { supplier_sku: item.supplierSku } : {}),
  }));
}

function applyPurchaseFilters<T extends { eq: (col: string, val: string) => T; gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(
  query: T,
  searchParams: URLSearchParams,
) {
  const from = searchParams.get("from");
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");

  let filteredQuery = query;

  if (status) {
    filteredQuery = filteredQuery.eq("status", status);
  }

  if (supplierId) {
    filteredQuery = filteredQuery.eq("supplier_id", supplierId);
  }

  if (from) {
    filteredQuery = filteredQuery.gte("created_at", `${from}T00:00:00.000Z`);
  }

  if (to) {
    filteredQuery = filteredQuery.lte("created_at", `${to}T23:59:59.999Z`);
  }

  return filteredQuery;
}

function mapPurchaseListRow(row: PurchaseListRow) {
  return {
    ...mapPurchase(row),
    itemsCount: row.purchase_items?.[0]?.count ?? 0,
    supplier: row.supplier ? mapContact(row.supplier) : undefined,
  };
}

export async function listPurchases(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  let query = supabase
    .from("purchases")
    .select(purchaseSelect, { count: "exact" })
    .order("created_at", { ascending: false });

  query = applyPurchaseFilters(query, searchParams);

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapPurchaseListRow(row as unknown as PurchaseListRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getPurchaseById(id: string) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase
    .from("purchases")
    .select(purchaseDetailSelect)
    .eq("id", id)
    .maybeSingle<PurchaseDetailRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select(paymentSelect)
    .eq("purchase_id", id)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(paymentsError);

  return {
    ...mapPurchase(data),
    items: (data.purchase_items ?? []).map((item) => mapPurchaseItem(item)),
    payments: (payments ?? []).map((payment) => mapPayment(payment as DbPaymentRow)),
    supplier: data.supplier ? mapContact(data.supplier) : undefined,
  };
}

export async function createPurchase(input: PurchaseInput) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("create_purchase", {
    p_discount_ref: input.discountRef ?? 0,
    p_exchange_rate_id: input.exchangeRateId ?? null,
    p_items: toRpcItems(input.items ?? []),
    p_notes: input.notes ?? null,
    p_purchase_number: input.purchaseNumber ?? null,
    p_ref_rate_ves: input.refRateVes ?? null,
    p_status: (input.status ?? "recibido") as PurchaseStatus,
    p_supplier_id: input.supplierId,
    p_tax_ref: input.taxRef ?? 0,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la compra.");
  }

  return mapPurchase(data as DbPurchaseRow);
}

export async function receivePurchase(id: string) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("receive_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return getPurchaseById(id);
}

export async function cancelPurchase(id: string) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("cancel_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return getPurchaseById(id);
}

export async function returnPurchase(id: string) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("return_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  const purchase = await getPurchaseById(id);

  const { data: stockMovements, error: movementsError } = await supabase
    .from("stock_movements")
    .select("id, product_id, purchase_id, type, quantity_delta, reason, created_at")
    .eq("purchase_id", id)
    .eq("type", "devolucion_proveedor")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(movementsError);

  return {
    purchase,
    stockMovements: (stockMovements ?? []).map((movement) =>
      mapStockMovement(movement as DbStockMovementRow),
    ),
  };
}
