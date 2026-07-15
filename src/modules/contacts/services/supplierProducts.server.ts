import { ApiError } from "@/lib/api/apiError";
import { assertContactType } from "@/lib/supabase/contacts";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import {
  computeVariationPercent,
  mapSupplierProduct,
  mapSupplierProductPackUnit,
  mapSupplierProductPriceHistory,
  type DbSupplierProductPackUnitRow,
  type DbSupplierProductPriceHistoryRow,
  type DbSupplierProductRow,
} from "@/lib/supabase/mappers/supplierProducts";
import { getPaginationRange, toPaginatedList } from "@/lib/supabase/pagination";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { SUPPLIER_PRODUCT_SELECT } from "./contacts.server";
import { applySupplierProductSort } from "./supplierProductSort";
import { buildProductSearchOrFilter } from "@/modules/products/services/productSearch";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

import type {
  SupplierProductCreateInput,
  SupplierProductMetadataUpdateInput,
  SupplierProductPackUnitInput,
  SupplierProductPackUnitUpdateInput,
  SupplierProductRegisterPriceInput,
} from "../types/supplierProducts";

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isMissingPackUnitsSchema(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = String(error.code);
  if (code === "42P01" || code === "42703" || code === "PGRST205") {
    return true;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message.toLowerCase() : "";

  return message.includes("supplier_product_pack_units");
}

function escapeIlike(value: string) {
  return value.replace(/[%_,]/g, "");
}

async function findProductIdsMatchingSearch(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  search: string,
) {
  const term = escapeIlike(search.trim());
  if (!term) {
    return [];
  }

  const { data, error } = await supabase
    .from("products")
    .select("id")
    .or(buildProductSearchOrFilter(term));

  throwIfSupabaseError(error);

  return (data ?? []).map((row) => String(row.id));
}

async function resolveSupplierProductSearch(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  search: string | null,
) {
  const term = search?.trim();
  if (!term) {
    return null;
  }

  const escapedTerm = escapeIlike(term);
  const productIds = await findProductIdsMatchingSearch(supabase, term);

  return { productIds, term: escapedTerm };
}

function applySupplierProductSearchFilter<TQuery extends {
  ilike: (column: string, pattern: string) => TQuery;
  or: (filters: string) => TQuery;
}>(
  query: TQuery,
  filter: { productIds: string[]; term: string },
): TQuery {
  if (filter.productIds.length === 0) {
    return query.ilike("supplier_sku", `%${filter.term}%`);
  }

  const quotedIds = filter.productIds.map((id) => `"${id}"`).join(",");
  return query.or(`supplier_sku.ilike.%${filter.term}%,product_id.in.(${quotedIds})`);
}

async function deleteSupplierProductRow(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase.from("supplier_products").delete().eq("id", id);

  throwIfSupabaseError(error);
}

async function fetchSupplierProductLink(supplierId: string, productId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_products")
    .select("id, is_active")
    .eq("supplier_id", supplierId)
    .eq("product_id", productId)
    .maybeSingle();

  throwIfSupabaseError(error);

  return data as { id: string; is_active?: boolean | null } | null;
}

async function reactivateSupplierProductRow(id: string, input: SupplierProductCreateInput) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_products")
    .update({
      is_active: true,
      notes: input.notes ?? null,
      supplier_sku: normalizeOptionalSku(input.supplierSku) ?? null,
    })
    .eq("id", id)
    .select(SUPPLIER_PRODUCT_SELECT)
    .single();

  throwIfSupabaseError(error);

  return data as DbSupplierProductRow;
}

async function finalizeSupplierProductCreate(
  row: DbSupplierProductRow,
  input: SupplierProductCreateInput,
  rollback: () => Promise<void>,
) {
  if (input.lastCostRef != null && input.lastCostRef >= 0) {
    try {
      await registerSupplierProductPrice(row.id, {
        newCostRef: input.lastCostRef,
        newCostVes: input.lastCostVes,
        notes: input.notes,
        origin: "vinculacion",
      });

      return getSupplierProductById(row.id);
    } catch (error) {
      await rollback();
      throw error;
    }
  }

  return mapSupplierProduct(row, {
    variationPercent: null,
  });
}

async function ensureProductExists(productId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("products").select("id").eq("id", productId).single();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }
}

async function fetchSupplierProductRow(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_products")
    .select(SUPPLIER_PRODUCT_SELECT)
    .eq("id", id)
    .single();

  throwIfSupabaseError(error);

  return data as DbSupplierProductRow;
}

async function fetchLatestHistoryBySupplierProductIds(ids: string[]) {
  if (ids.length === 0) {
    return new Map<
      string,
      { origin: string; variationPercent: number | null; lastPriceOrigin?: string }
    >();
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_product_price_history")
    .select("supplier_product_id, origin, old_cost_ref, new_cost_ref, created_at")
    .in("supplier_product_id", ids)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error);

  const grouped = new Map<string, DbSupplierProductPriceHistoryRow[]>();

  for (const row of (data ?? []) as DbSupplierProductPriceHistoryRow[]) {
    const current = grouped.get(row.supplier_product_id) ?? [];
    current.push(row);
    grouped.set(row.supplier_product_id, current);
  }

  const result = new Map<
    string,
    { lastPriceOrigin?: string; variationPercent: number | null }
  >();

  for (const [supplierProductId, rows] of grouped.entries()) {
    const latest = rows[0];
    const previous = rows[1];
    result.set(supplierProductId, {
      lastPriceOrigin: latest?.origin,
      variationPercent: previous
        ? computeVariationPercent(
            Number(previous.new_cost_ref),
            Number(latest?.new_cost_ref ?? 0),
          )
        : null,
    });
  }

  return result;
}

async function fetchPackUnitsBySupplierProductIds(ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, ReturnType<typeof mapSupplierProductPackUnit>[]>();
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_product_pack_units")
    .select("*")
    .in("supplier_product_id", ids)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("label", { ascending: true });

  if (error && isMissingPackUnitsSchema(error)) {
    return new Map<string, ReturnType<typeof mapSupplierProductPackUnit>[]>();
  }

  throwIfSupabaseError(error);

  const grouped = new Map<string, ReturnType<typeof mapSupplierProductPackUnit>[]>();

  for (const row of (data ?? []) as DbSupplierProductPackUnitRow[]) {
    const current = grouped.get(row.supplier_product_id) ?? [];
    current.push(mapSupplierProductPackUnit(row));
    grouped.set(row.supplier_product_id, current);
  }

  return grouped;
}

function mapRowsWithHistory(
  rows: DbSupplierProductRow[],
  historyMap: Map<string, { lastPriceOrigin?: string; variationPercent: number | null }>,
  packUnitsMap: Map<string, ReturnType<typeof mapSupplierProductPackUnit>[]>,
) {
  return rows.map((row) => {
    const history = historyMap.get(row.id);
    const packUnits = packUnitsMap.get(row.id) ?? [];

    return mapSupplierProduct(row, {
      lastPriceOrigin: history?.lastPriceOrigin as
        | "ajuste"
        | "compra"
        | "cotizacion"
        | "vinculacion"
        | undefined,
      packUnits,
      variationPercent: history?.variationPercent ?? null,
    });
  });
}

export async function listSupplierProducts(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const productId = searchParams.get("productId");
  const supplierId = searchParams.get("supplierId");
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search");
  const { skip, to } = getPaginationRange(searchParams);

  let query = supabase.from("supplier_products").select(SUPPLIER_PRODUCT_SELECT, { count: "exact" });

  if (productId) {
    query = query.eq("product_id", productId);
  }

  if (supplierId) {
    query = query.eq("supplier_id", supplierId);
  }

  if (isActive != null && isActive !== "") {
    query = query.eq("is_active", isActive.toLowerCase() === "true");
  }

  const searchFilter = await resolveSupplierProductSearch(supabase, search);
  if (searchFilter) {
    query = applySupplierProductSearchFilter(query, searchFilter);
  }

  const result = await applySupplierProductSort(query, searchParams).range(skip, to);
  const rows = (result.data ?? []) as DbSupplierProductRow[];
  const ids = rows.map((row) => row.id);
  const historyMap = await fetchLatestHistoryBySupplierProductIds(ids);
  const packUnitsMap = await fetchPackUnitsBySupplierProductIds(ids);

  return toPaginatedList(
    searchParams,
    {
      count: result.count,
      data: mapRowsWithHistory(rows, historyMap, packUnitsMap),
      error: result.error,
    },
    (item) => item,
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
  const row = await fetchSupplierProductRow(id);
  const historyMap = await fetchLatestHistoryBySupplierProductIds([id]);
  const packUnitsMap = await fetchPackUnitsBySupplierProductIds([id]);
  const packUnits = packUnitsMap.get(id) ?? [];

  return mapSupplierProduct(row, {
    lastPriceOrigin: historyMap.get(id)?.lastPriceOrigin as
      | "ajuste"
      | "compra"
      | "cotizacion"
      | "vinculacion"
      | undefined,
    packUnits,
    variationPercent: historyMap.get(id)?.variationPercent ?? null,
  });
}

export async function createSupplierProduct(input: SupplierProductCreateInput) {
  const supabase = await createRouteSupabaseClient();

  if (!input.productId || !input.supplierId) {
    throw new ApiError(400, "BAD_REQUEST", "Proveedor y producto son obligatorios.");
  }

  await assertContactType(supabase, input.supplierId, ["proveedor", "ambos"]);
  await ensureProductExists(input.productId);

  const existing = await fetchSupplierProductLink(input.supplierId, input.productId);

  if (existing) {
    if (existing.is_active !== false) {
      throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
    }

    const reactivated = await reactivateSupplierProductRow(existing.id, input);

    return finalizeSupplierProductCreate(reactivated, input, async () => {
      await supabase.from("supplier_products").update({ is_active: false }).eq("id", existing.id);
    });
  }

  const { data, error } = await supabase
    .from("supplier_products")
    .insert({
      is_active: true,
      notes: input.notes ?? null,
      product_id: input.productId,
      supplier_id: input.supplierId,
      supplier_sku: normalizeOptionalSku(input.supplierSku) ?? null,
    })
    .select(SUPPLIER_PRODUCT_SELECT)
    .single();

  if (isUniqueViolation(error)) {
    const duplicate = await fetchSupplierProductLink(input.supplierId, input.productId);

    if (duplicate && duplicate.is_active === false) {
      const reactivated = await reactivateSupplierProductRow(duplicate.id, input);

      return finalizeSupplierProductCreate(reactivated, input, async () => {
        await supabase.from("supplier_products").update({ is_active: false }).eq("id", duplicate.id);
      });
    }

    throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
  }

  throwIfSupabaseError(error);

  const row = data as DbSupplierProductRow;

  return finalizeSupplierProductCreate(row, input, async () => {
    await deleteSupplierProductRow(row.id);
  });
}

export async function updateSupplierProduct(id: string, input: SupplierProductMetadataUpdateInput) {
  const supabase = await createRouteSupabaseClient();
  await getSupplierProductById(id);

  if (input.supplierId) {
    await assertContactType(supabase, input.supplierId, ["proveedor", "ambos"]);
  }

  if (input.productId) {
    await ensureProductExists(input.productId);
  }

  const payload: Record<string, boolean | string | null | undefined> = {};

  if (input.productId !== undefined) payload.product_id = input.productId;
  if (input.supplierId !== undefined) payload.supplier_id = input.supplierId;
  if (input.supplierSku !== undefined) {
    payload.supplier_sku = normalizeOptionalSku(input.supplierSku);
  }
  if (input.notes !== undefined) payload.notes = input.notes;
  if (input.isActive !== undefined) payload.is_active = input.isActive;

  const { error } = await supabase
    .from("supplier_products")
    .update(payload)
    .eq("id", id)
    .select(SUPPLIER_PRODUCT_SELECT)
    .single();

  if (isUniqueViolation(error)) {
    throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
  }

  throwIfSupabaseError(error);

  return getSupplierProductById(id);
}

export async function registerSupplierProductPrice(
  id: string,
  input: SupplierProductRegisterPriceInput,
) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("register_supplier_product_price", {
    p_new_cost_ref: input.newCostRef,
    p_new_cost_ves: input.newCostVes ?? null,
    p_new_pack_cost_ref: input.newPackCostRef ?? null,
    p_notes: input.notes ?? null,
    p_origin: input.origin ?? "cotizacion",
    p_price_input_mode: input.priceInputMode ?? null,
    p_supplier_product_id: id,
  });

  throwIfSupabaseError(error);

  const payload = data as {
    history_id: string;
    supplier_product: DbSupplierProductRow;
    variation_percent: number | null;
  };

  return {
    historyId: payload.history_id,
    supplierProduct: mapSupplierProduct(payload.supplier_product, {
      lastPriceOrigin: input.origin ?? "cotizacion",
      variationPercent: payload.variation_percent,
    }),
    variationPercent: payload.variation_percent,
  };
}

export async function deactivateSupplierProduct(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("deactivate_supplier_product", {
    p_id: id,
  });

  throwIfSupabaseError(error);

  return getSupplierProductById((data as DbSupplierProductRow).id);
}

export async function listSupplierProductPriceHistory(id: string, searchParams: URLSearchParams) {
  await getSupplierProductById(id);

  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);
  const result = await supabase
    .from("supplier_product_price_history")
    .select("*", { count: "exact" })
    .eq("supplier_product_id", id)
    .order("created_at", { ascending: false })
    .range(skip, to);

  return toPaginatedList(
    searchParams,
    result as { count: number | null; data: DbSupplierProductPriceHistoryRow[] | null; error: unknown },
    mapSupplierProductPriceHistory,
  );
}

async function unsetDefaultPackUnits(supplierProductId: string, excludeId?: string) {
  const supabase = await createRouteSupabaseClient();
  let query = supabase
    .from("supplier_product_pack_units")
    .update({ is_default: false })
    .eq("supplier_product_id", supplierProductId)
    .eq("is_default", true);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { error } = await query;
  throwIfSupabaseError(error);
}

export async function listSupplierProductPackUnits(supplierProductId: string) {
  await getSupplierProductById(supplierProductId);

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_product_pack_units")
    .select("*")
    .eq("supplier_product_id", supplierProductId)
    .order("is_default", { ascending: false })
    .order("label", { ascending: true });

  if (error && isMissingPackUnitsSchema(error)) {
    return [];
  }

  throwIfSupabaseError(error);

  return ((data ?? []) as DbSupplierProductPackUnitRow[]).map(mapSupplierProductPackUnit);
}

export async function createSupplierProductPackUnit(
  supplierProductId: string,
  input: SupplierProductPackUnitInput,
) {
  await getSupplierProductById(supplierProductId);

  const supabase = await createRouteSupabaseClient();
  const isDefault = input.isDefault ?? false;

  if (isDefault) {
    await unsetDefaultPackUnits(supplierProductId);
  }

  const { data, error } = await supabase
    .from("supplier_product_pack_units")
    .insert({
      is_active: true,
      is_default: isDefault,
      label: input.label.trim(),
      supplier_product_id: supplierProductId,
      units_per_pack: input.unitsPerPack,
    })
    .select("*")
    .single();

  throwIfSupabaseError(error);

  return mapSupplierProductPackUnit(data as DbSupplierProductPackUnitRow);
}

export async function updateSupplierProductPackUnit(
  supplierProductId: string,
  packUnitId: string,
  input: SupplierProductPackUnitUpdateInput,
) {
  await getSupplierProductById(supplierProductId);

  const supabase = await createRouteSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("supplier_product_pack_units")
    .select("*")
    .eq("id", packUnitId)
    .eq("supplier_product_id", supplierProductId)
    .single();

  throwIfSupabaseError(existingError);

  if (!existing) {
    throw new ApiError(404, "NOT_FOUND", "Empaque no encontrado.");
  }

  if (input.isDefault === true) {
    await unsetDefaultPackUnits(supplierProductId, packUnitId);
  }

  const payload: Record<string, boolean | number | string | null> = {};

  if (input.label !== undefined) payload.label = input.label.trim();
  if (input.unitsPerPack !== undefined) payload.units_per_pack = input.unitsPerPack;
  if (input.isDefault !== undefined) payload.is_default = input.isDefault;
  if (input.isActive !== undefined) payload.is_active = input.isActive;

  const { data, error } = await supabase
    .from("supplier_product_pack_units")
    .update(payload)
    .eq("id", packUnitId)
    .select("*")
    .single();

  throwIfSupabaseError(error);

  return mapSupplierProductPackUnit(data as DbSupplierProductPackUnitRow);
}

export async function deactivateSupplierProductPackUnit(
  supplierProductId: string,
  packUnitId: string,
) {
  return updateSupplierProductPackUnit(supplierProductId, packUnitId, {
    isActive: false,
    isDefault: false,
  });
}

export type SupplierProductInput = SupplierProductCreateInput;
