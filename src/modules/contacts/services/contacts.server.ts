import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapContact } from "@/lib/supabase/mappers/contacts";
import {
  mapPayment,
  mapPurchase,
  mapSale,
  type DbPaymentRow,
  type DbPurchaseRow,
  type DbSaleRow,
} from "@/lib/supabase/mappers/transactions";
import { getPaginationRange, toPaginatedList } from "@/lib/supabase/pagination";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { ContactInput } from "./contacts.mock-server";

const SUPPLIER_PRODUCT_SELECT = `
  *,
  product:products(id, sku, name, category_id, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active, image_url),
  supplier:contacts(id, type, name, tax_id, email, phone, address, is_active, created_at, updated_at)
`;

function escapeIlike(value: string) {
  return value.replace(/[%_,]/g, "");
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function applyContactTypeFilter<T extends { eq: (column: string, value: string) => T; in: (column: string, values: string[]) => T }>(
  query: T,
  type: string | null,
) {
  if (!type) {
    return query;
  }

  if (type === "cliente") {
    return query.in("type", ["cliente", "ambos"]);
  }

  if (type === "proveedor") {
    return query.in("type", ["proveedor", "ambos"]);
  }

  return query.eq("type", type);
}

export async function listContacts(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const type = searchParams.get("type");
  const search = searchParams.get("search")?.trim();
  const { skip, to } = getPaginationRange(searchParams);

  let query = supabase.from("contacts").select("*", { count: "exact" });

  query = applyContactTypeFilter(query, type);

  if (search) {
    const term = escapeIlike(search);
    query = query.or(`name.ilike.%${term}%,tax_id.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const result = await query.order("name").range(skip, to);

  return toPaginatedList(searchParams, result, mapContact);
}

export async function getContactById(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("contacts").select("*").eq("id", id).single();

  throwIfSupabaseError(error);

  return mapContact(data);
}

export async function createContact(input: ContactInput) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      address: input.address ?? null,
      email: input.email ?? null,
      name: input.name ?? "Contacto",
      phone: input.phone ?? null,
      tax_id: input.taxId ?? null,
      type: input.type ?? "cliente",
    })
    .select("*")
    .single();

  if (isUniqueViolation(error)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un contacto con este RIF/CI.");
  }

  throwIfSupabaseError(error);

  return mapContact(data);
}

export async function updateContact(id: string, input: ContactInput) {
  const supabase = await createRouteSupabaseClient();
  const payload: Record<string, string | null | undefined> = {};

  if (input.address !== undefined) payload.address = input.address;
  if (input.email !== undefined) payload.email = input.email;
  if (input.name !== undefined) payload.name = input.name;
  if (input.phone !== undefined) payload.phone = input.phone;
  if (input.taxId !== undefined) payload.tax_id = input.taxId;
  if (input.type !== undefined) payload.type = input.type;

  const { data, error } = await supabase
    .from("contacts")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (isUniqueViolation(error)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un contacto con este RIF/CI.");
  }

  throwIfSupabaseError(error);

  return mapContact(data);
}

async function ensureContactExists(id: string) {
  await getContactById(id);
}

export async function getContactSales(id: string, searchParams: URLSearchParams) {
  await ensureContactExists(id);

  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);
  const result = await supabase
    .from("sales")
    .select("*", { count: "exact" })
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .range(skip, to);

  return toPaginatedList(searchParams, result as { count: number | null; data: DbSaleRow[] | null; error: unknown }, mapSale);
}

export async function getContactPurchases(id: string, searchParams: URLSearchParams) {
  await ensureContactExists(id);

  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);
  const result = await supabase
    .from("purchases")
    .select("*", { count: "exact" })
    .eq("supplier_id", id)
    .order("created_at", { ascending: false })
    .range(skip, to);

  return toPaginatedList(
    searchParams,
    result as { count: number | null; data: DbPurchaseRow[] | null; error: unknown },
    mapPurchase,
  );
}

export async function getContactPayments(id: string, searchParams: URLSearchParams) {
  await ensureContactExists(id);

  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);
  const result = await supabase
    .from("payments")
    .select("*", { count: "exact" })
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .range(skip, to);

  return toPaginatedList(
    searchParams,
    result as { count: number | null; data: DbPaymentRow[] | null; error: unknown },
    mapPayment,
  );
}

export async function getContactActivity(id: string, searchParams: URLSearchParams) {
  await ensureContactExists(id);

  const supabase = await createRouteSupabaseClient();
  const [salesResult, purchasesResult, paymentsResult] = await Promise.all([
    supabase.from("sales").select("id, total_ves, created_at").eq("customer_id", id),
    supabase.from("purchases").select("id, total_ves, created_at").eq("supplier_id", id),
    supabase.from("payments").select("id, amount_ves, created_at").eq("contact_id", id),
  ]);

  throwIfSupabaseError(salesResult.error);
  throwIfSupabaseError(purchasesResult.error);
  throwIfSupabaseError(paymentsResult.error);

  const items = [
    ...(salesResult.data ?? []).map((sale) => ({
      amountVes: Number(sale.total_ves ?? 0),
      createdAt: sale.created_at ?? "",
      id: sale.id,
      type: "sale" as const,
    })),
    ...(purchasesResult.data ?? []).map((purchase) => ({
      amountVes: Number(purchase.total_ves ?? 0),
      createdAt: purchase.created_at ?? "",
      id: purchase.id,
      type: "purchase" as const,
    })),
    ...(paymentsResult.data ?? []).map((payment) => ({
      amountVes: Number(payment.amount_ves ?? 0),
      createdAt: payment.created_at ?? "",
      id: payment.id,
      type: "payment" as const,
    })),
  ].sort((first, second) => first.createdAt.localeCompare(second.createdAt));

  return paginateList(items, searchParams);
}

export { SUPPLIER_PRODUCT_SELECT };
