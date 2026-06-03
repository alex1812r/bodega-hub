import { ApiError } from "@/lib/api/apiError";
import { assertContactType } from "@/lib/supabase/contacts";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapSupplierProduct, type DbSupplierProductRow } from "@/lib/supabase/mappers/supplierProducts";
import { getPaginationRange, toPaginatedList } from "@/lib/supabase/pagination";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { SUPPLIER_PRODUCT_SELECT } from "./contacts.server";

import type { SupplierProductInput } from "./supplierProducts.mock-server";

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function ensureProductExists(productId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("products").select("id").eq("id", productId).single();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }
}

async function fetchSupplierProductById(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_products")
    .select(SUPPLIER_PRODUCT_SELECT)
    .eq("id", id)
    .single();

  throwIfSupabaseError(error);

  return mapSupplierProduct(data as DbSupplierProductRow);
}

export async function listSupplierProducts(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const productId = searchParams.get("productId");
  const supplierId = searchParams.get("supplierId");
  const { skip, to } = getPaginationRange(searchParams);

  let query = supabase.from("supplier_products").select(SUPPLIER_PRODUCT_SELECT, { count: "exact" });

  if (productId) {
    query = query.eq("product_id", productId);
  }

  if (supplierId) {
    query = query.eq("supplier_id", supplierId);
  }

  const result = await query.order("updated_at", { ascending: false }).range(skip, to);

  return toPaginatedList(
    searchParams,
    result as { count: number | null; data: DbSupplierProductRow[] | null; error: unknown },
    mapSupplierProduct,
  );
}

export async function listProductSuppliers(productId: string, searchParams: URLSearchParams) {
  await ensureProductExists(productId);

  const params = new URLSearchParams(searchParams);
  params.set("productId", productId);

  return listSupplierProducts(params);
}

export async function listSupplierProductsBySupplier(supplierId: string, searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  await assertContactType(supabase, supplierId, ["proveedor", "ambos"]);

  const params = new URLSearchParams(searchParams);
  params.set("supplierId", supplierId);

  return listSupplierProducts(params);
}

export async function getSupplierProductById(id: string) {
  return fetchSupplierProductById(id);
}

export async function createSupplierProduct(input: SupplierProductInput) {
  const supabase = await createRouteSupabaseClient();

  if (!input.productId || !input.supplierId) {
    throw new ApiError(400, "BAD_REQUEST", "Proveedor y producto son obligatorios.");
  }

  await assertContactType(supabase, input.supplierId, ["proveedor", "ambos"]);
  await ensureProductExists(input.productId);

  const { data, error } = await supabase
    .from("supplier_products")
    .insert({
      last_cost_ref: input.lastCostRef ?? 0,
      product_id: input.productId,
      supplier_id: input.supplierId,
      supplier_sku: input.supplierSku ?? null,
    })
    .select(SUPPLIER_PRODUCT_SELECT)
    .single();

  if (isUniqueViolation(error)) {
    throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
  }

  throwIfSupabaseError(error);

  return mapSupplierProduct(data as DbSupplierProductRow);
}

export async function updateSupplierProduct(id: string, input: SupplierProductInput) {
  const supabase = await createRouteSupabaseClient();
  await fetchSupplierProductById(id);

  if (input.supplierId) {
    await assertContactType(supabase, input.supplierId, ["proveedor", "ambos"]);
  }

  if (input.productId) {
    await ensureProductExists(input.productId);
  }

  const payload: Record<string, number | string | null | undefined> = {};

  if (input.lastCostRef !== undefined) payload.last_cost_ref = input.lastCostRef;
  if (input.productId !== undefined) payload.product_id = input.productId;
  if (input.supplierId !== undefined) payload.supplier_id = input.supplierId;
  if (input.supplierSku !== undefined) payload.supplier_sku = input.supplierSku;

  const { data, error } = await supabase
    .from("supplier_products")
    .update(payload)
    .eq("id", id)
    .select(SUPPLIER_PRODUCT_SELECT)
    .single();

  if (isUniqueViolation(error)) {
    throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
  }

  throwIfSupabaseError(error);

  return mapSupplierProduct(data as DbSupplierProductRow);
}
