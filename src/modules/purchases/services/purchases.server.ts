import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
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

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { normalizePurchaseLine, toRpcPurchaseItem } from "../schemas/purchaseItem.schema";
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
  subtotal_ves,
  discount_ref,
  discount_ves,
  tax_ref,
  tax_ves,
  total_ref,
  total_ves,
  paid_ves,
  paid_ref,
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
  subtotal_ves,
  discount_ref,
  discount_ves,
  tax_ref,
  tax_ves,
  total_ref,
  total_ves,
  paid_ves,
  paid_ref,
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
    entry_mode,
    pack_label,
    pack_count,
    units_per_pack,
    pack_cost_ref,
    pack_cost_ves,
    tax_rate,
    tax_ref,
    tax_ves,
    cost_currency,
    product:products(${productSelect})
  )
`;

const paymentSelect = `
  id,
  direction,
  sale_id,
  purchase_id,
  contact_id,
  method,
  currency,
  amount,
  amount_ves,
  amount_ref,
  ref_rate_ves,
  bank_name,
  reference_code,
  created_at,
  contact:contacts(${contactSelect})
`;

type PurchaseListRow = DbPurchaseRow & {
  purchase_items?: Array<{ count: number }>;
  supplier?: DbContactRow | null;
};

type PurchaseDetailRow = DbPurchaseRow & {
  purchase_items?: DbPurchaseItemRow[];
  supplier?: DbContactRow | null;
};

function toRpcItems(items: NonNullable<PurchaseInput["items"]>) {
  return items.map((item) => toRpcPurchaseItem(item as PurchaseItemInput));
}

function applyPurchaseFilters<
  T extends {
    eq: (col: string, val: string) => T;
    gte: (col: string, val: string) => T;
    ilike: (col: string, val: string) => T;
    lte: (col: string, val: string) => T;
  },
>(
  query: T,
  searchParams: URLSearchParams,
) {
  const from = searchParams.get("from");
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");

  let filteredQuery = query;

  if (search) {
    filteredQuery = filteredQuery.ilike("purchase_number", `%${search}%`);
  }

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

export async function listPurchases(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  let query = supabase
    .from("purchases")
    .select(purchaseSelect, { count: "exact" })
    .eq("store_id", storeId)
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

export async function getPurchaseById(id: string, storeId: string) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
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

  const mappedPayments = (payments ?? []).map((payment) => {
    const row = payment as unknown as DbPaymentRow & {
      contact?: DbContactRow | DbContactRow[] | null;
    };
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;

    return {
      ...mapPayment(row),
      contact: contact ? mapContact(contact) : undefined,
    };
  });

  const activePayments = mappedPayments.filter((payment) => payment.status !== "anulado");
  const paidRefFromPayments =
    Math.round(
      activePayments.reduce((sum, payment) => {
        if (payment.amountRef > 0) {
          return sum + payment.amountRef;
        }

        if (payment.refRateVes > 0 && payment.amountVes > 0) {
          return sum + payment.amountVes / payment.refRateVes;
        }

        return sum;
      }, 0) * 100,
    ) / 100;
  const paidVesFromPayments =
    Math.round(activePayments.reduce((sum, payment) => sum + payment.amountVes, 0) * 100) / 100;

  const mappedPurchase = mapPurchase(data);

  return {
    ...mappedPurchase,
    // Prefer sums from payment history so the status card stays in sync with the table.
    paidRef: paidRefFromPayments,
    paidVes: paidVesFromPayments,
    items: (data.purchase_items ?? []).map((item) => mapPurchaseItem(item)),
    payments: mappedPayments,
    supplier: data.supplier ? mapContact(data.supplier) : undefined,
  };
}

export async function createPurchase(input: PurchaseInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("create_purchase", {
    p_discount_ref: input.discountRef ?? 0,
    p_discount_ves: input.discountVes ?? null,
    p_exchange_rate_id: input.exchangeRateId ?? null,
    p_items: toRpcItems(input.items ?? []),
    p_notes: input.notes ?? null,
    p_purchase_number: input.purchaseNumber ?? null,
    p_ref_rate_ves: input.refRateVes ?? null,
    p_status: (input.status ?? "recibido") as PurchaseStatus,
    p_subtotal_ref: input.subtotalRef ?? null,
    p_subtotal_ves: input.subtotalVes ?? null,
    p_supplier_id: input.supplierId,
    p_tax_ref: input.taxRef ?? 0,
    p_tax_ves: input.taxVes ?? null,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la compra.");
  }

  return mapPurchase(data as DbPurchaseRow);
}

export async function receivePurchase(id: string, storeId: string) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("receive_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return getPurchaseById(id, storeId);
}

export async function cancelPurchase(id: string, storeId: string) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("cancel_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return getPurchaseById(id, storeId);
}

export async function returnPurchase(id: string, storeId: string) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("return_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  const purchase = await getPurchaseById(id, storeId);

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
