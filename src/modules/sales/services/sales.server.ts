import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination, type PaginatedList } from "@/lib/api/pagination";
import { getSupabaseErrorMessage, mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapBaseEntity, mapNullableString } from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { SaleInput, SaleUpdateInput } from "./sales.mock-server";

type SaleStatus =
  | "borrador"
  | "cancelada"
  | "devuelta"
  | "pagada"
  | "pendiente_pago";

type SaleRow = {
  created_at: string;
  customer_id: string;
  discount_ref: number;
  exchange_rate_id: string | null;
  id: string;
  invoice_number: string;
  notes: string | null;
  paid_ves: number;
  ref_rate_ves: number;
  status: SaleStatus;
  subtotal_ref: number;
  tax_ref: number;
  total_ref: number;
  total_ves: number;
  updated_at: string;
  user_id: string | null;
};

type ContactRow = {
  address: string | null;
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
  type: string;
};

type ProductRow = {
  id: string;
  name: string;
  sale_price_ref: number;
  sku: string;
};

type SaleItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  sale_id: string;
  subtotal_ref: number;
  subtotal_ves: number;
  unit_cost_ref_snapshot: number;
  unit_price_ref: number;
};

type PaymentRow = {
  amount: number;
  amount_ref: number;
  amount_ves: number;
  bank_name: string | null;
  contact_id: string;
  created_at: string;
  currency: string;
  direction: string;
  id: string;
  method: string;
  notes: string | null;
  phone: string | null;
  reference_code: string | null;
  ref_rate_ves: number;
  sale_id: string | null;
};

type StockMovementRow = {
  created_at: string;
  id: string;
  product_id: string;
  quantity_delta: number;
  reason: string | null;
  sale_id: string | null;
  type: string;
};

type SaleListRow = SaleRow & {
  customer: ContactRow | null;
  sale_items: Array<{ count: number }> | null;
};

type SaleDetailRow = SaleRow & {
  customer: ContactRow | null;
  payments: PaymentRow[] | null;
  sale_items: Array<SaleItemRow & { product: ProductRow | null }> | null;
};

function mapContact(contact: ContactRow | null | undefined) {
  if (!contact) {
    return undefined;
  }

  return {
    address: mapNullableString(contact.address),
    email: mapNullableString(contact.email),
    id: contact.id,
    name: contact.name,
    phone: mapNullableString(contact.phone),
    type: contact.type,
  };
}

function mapProduct(product: ProductRow | null | undefined) {
  if (!product) {
    return undefined;
  }

  return {
    id: product.id,
    name: product.name,
    salePriceRef: Number(product.sale_price_ref),
    sku: product.sku,
  };
}

export function mapSaleRow(row: SaleRow) {
  return {
    ...mapBaseEntity(row),
    customerId: row.customer_id,
    discountRef: Number(row.discount_ref),
    exchangeRateId: row.exchange_rate_id ?? undefined,
    invoiceNumber: row.invoice_number,
    notes: mapNullableString(row.notes),
    paidVes: Number(row.paid_ves),
    refRateVes: Number(row.ref_rate_ves),
    status: row.status,
    subtotalRef: Number(row.subtotal_ref),
    taxRef: Number(row.tax_ref),
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
    userId: row.user_id ?? "",
  };
}

function mapSaleItemRow(row: SaleItemRow & { product?: ProductRow | null }) {
  return {
    product: mapProduct(row.product),
    productId: row.product_id,
    quantity: row.quantity,
    saleId: row.sale_id,
    subtotalRef: Number(row.subtotal_ref),
    subtotalVes: Number(row.subtotal_ves),
    unitCostRefSnapshot: Number(row.unit_cost_ref_snapshot),
    unitPriceRef: Number(row.unit_price_ref),
  };
}

function mapPaymentRow(row: PaymentRow) {
  return {
    amount: Number(row.amount),
    amountRef: Number(row.amount_ref),
    amountVes: Number(row.amount_ves),
    bankName: mapNullableString(row.bank_name),
    contactId: row.contact_id,
    createdAt: row.created_at,
    currency: row.currency,
    direction: row.direction,
    id: row.id,
    method: row.method,
    notes: mapNullableString(row.notes),
    phone: mapNullableString(row.phone),
    referenceCode: mapNullableString(row.reference_code),
    refRateVes: Number(row.ref_rate_ves),
    saleId: row.sale_id ?? undefined,
  };
}

function mapStockMovementRow(row: StockMovementRow) {
  return {
    createdAt: row.created_at,
    id: row.id,
    productId: row.product_id,
    quantityDelta: row.quantity_delta,
    reason: mapNullableString(row.reason),
    saleId: row.sale_id ?? undefined,
    type: row.type,
  };
}

function throwIfRpcError(error: unknown): void {
  if (!error) {
    return;
  }

  const message = getSupabaseErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("no encontrad") || normalized.includes("not found")) {
    throw new ApiError(404, "NOT_FOUND", message);
  }

  if (
    normalized.includes("no autorizado") ||
    normalized.includes("not authorized") ||
    normalized.includes("permission denied")
  ) {
    throw new ApiError(403, "FORBIDDEN", message);
  }

  if (
    normalized.includes("stock insuficiente") ||
    normalized.includes("invalid") ||
    normalized.includes("debe") ||
    normalized.includes("ya fue cancelada") ||
    normalized.includes("ya fue devuelta")
  ) {
    throw new ApiError(400, "BAD_REQUEST", message);
  }

  throw mapSupabaseError(error);
}

function mapCreateSaleItems(items: NonNullable<SaleInput["items"]>) {
  return items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    ...(item.unitPriceRef !== undefined ? { unit_price_ref: item.unitPriceRef } : {}),
  }));
}

export async function listSales(searchParams: URLSearchParams, storeId: string): Promise<PaginatedList<ReturnType<typeof mapSaleRow> & {
  customer?: ReturnType<typeof mapContact>;
  itemsCount: number;
}>> {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  let query = supabase
    .from("sales")
    .select(
      "*, customer:contacts!sales_customer_id_fkey(id, name, type, email, phone, address), sale_items(count)",
      { count: "exact" },
    )
    .eq("store_id", storeId);

  const status = searchParams.get("status");
  if (status) {
    query = query.eq("status", status);
  }

  const customerId = searchParams.get("customerId");
  if (customerId) {
    query = query.eq("customer_id", customerId);
  }

  const search = searchParams.get("search")?.trim();
  if (search) {
    query = query.ilike("invoice_number", `%${search}%`);
  }

  const from = searchParams.get("from");
  if (from) {
    query = query.gte("created_at", `${from}T00:00:00.000Z`);
  }

  const to = searchParams.get("to");
  if (to) {
    query = query.lte("created_at", `${to}T23:59:59.999Z`);
  }

  const { count, data, error } = await query
    .order("created_at", { ascending: false })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  const rows = (data ?? []) as SaleListRow[];

  return {
    items: rows.map((row) => ({
      ...mapSaleRow(row),
      customer: mapContact(row.customer),
      itemsCount: row.sale_items?.[0]?.count ?? 0,
    })),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getSaleById(id: string, storeId: string) {
  await assertSupabaseStoreResource("sales", id, storeId, "Venta no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("sales")
    .select(
      "*, customer:contacts!sales_customer_id_fkey(id, name, type, email, phone, address), sale_items(*, product:products(id, name, sku, sale_price_ref)), payments(*)",
    )
    .eq("id", id)
    .maybeSingle<SaleDetailRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

  return {
    ...mapSaleRow(data),
    customer: mapContact(data.customer),
    items: (data.sale_items ?? []).map((item) => mapSaleItemRow(item)),
    payments: (data.payments ?? []).map((payment) => mapPaymentRow(payment)),
  };
}

export async function createSale(input: SaleInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("create_sale", {
    p_customer_id: input.customerId,
    p_discount_ref: input.discountRef ?? 0,
    p_exchange_rate_id: input.exchangeRateId ?? null,
    p_invoice_number: input.invoiceNumber ?? null,
    p_items: mapCreateSaleItems(input.items ?? []),
    p_notes: input.notes ?? null,
    p_ref_rate_ves: input.refRateVes ?? null,
    p_tax_ref: input.taxRef ?? 0,
  });

  throwIfRpcError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la venta.");
  }

  return mapSaleRow(data as SaleRow);
}

export async function updateSale(id: string, input: SaleUpdateInput, storeId: string) {
  await assertSupabaseStoreResource("sales", id, storeId, "Venta no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("sales")
    .update({
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle<SaleRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

  return getSaleById(data.id, storeId);
}

export async function cancelSale(id: string, storeId: string) {
  await assertSupabaseStoreResource("sales", id, storeId, "Venta no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_sale", {
    p_sale_id: id,
  });

  throwIfRpcError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

  return getSaleById((data as SaleRow).id, storeId);
}

export async function returnSale(id: string, storeId: string) {
  await assertSupabaseStoreResource("sales", id, storeId, "Venta no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("return_sale", {
    p_sale_id: id,
  });

  throwIfRpcError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

  const sale = await getSaleById((data as SaleRow).id, storeId);
  const { data: movements, error: movementsError } = await supabase
    .from("stock_movements")
    .select("id, product_id, type, quantity_delta, reason, sale_id, created_at")
    .eq("sale_id", id)
    .eq("type", "devolucion_cliente")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(movementsError);

  return {
    sale,
    stockMovements: (movements ?? []).map((movement) =>
      mapStockMovementRow(movement as StockMovementRow),
    ),
  };
}

export async function getSaleReceipt(id: string, storeId: string) {
  const sale = await getSaleById(id, storeId);

  return {
    customer: sale.customer,
    invoiceNumber: sale.invoiceNumber,
    items: sale.items,
    paidVes: sale.paidVes,
    pendingVes: sale.totalVes - sale.paidVes,
    saleId: sale.id,
    totalRef: sale.totalRef,
    totalVes: sale.totalVes,
  };
}
