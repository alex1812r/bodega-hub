import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination } from "@/lib/api/pagination";
import { mapCategory, type CategoryRow } from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { CategoryInput } from "./categories.mock-server";
import { parseCategoryDefaultMarkupPct } from "./categorySchemas";
import { isRangeNotSatisfiable, listCountOptions } from "./listRange";
import { escapeIlike, isUnsearchableSearchTerm, normalizeProductSearch } from "./productSearch";

const categorySelect =
  "id, name, description, tax_rate, tax_rate_id, default_markup_pct, is_active, created_at, updated_at";

type CategoryWithTaxRateRow = CategoryRow & { tax_rate_id?: string | null };

/** Categoria con su alicuota de IVA (`tax_rates.id`); `taxRate` es el porcentaje derivado. */
function mapCategoryWithTaxRate(row: CategoryWithTaxRateRow) {
  return {
    ...mapCategory(row),
    taxRateId: row.tax_rate_id ?? undefined,
  };
}

/** Columna `default_markup_pct`: número validado, `null` para borrarla o nada si no viene. */
function toDefaultMarkupPctColumn(input: CategoryInput): { default_markup_pct?: number | null } {
  const defaultMarkupPct = parseCategoryDefaultMarkupPct(input.defaultMarkupPct);

  return defaultMarkupPct === undefined ? {} : { default_markup_pct: defaultMarkupPct };
}

function toCategoryInsert(input: CategoryInput, storeId: string) {
  return {
    ...toDefaultMarkupPctColumn(input),
    description: input.description ?? null,
    name: input.name ?? "Categoria",
    store_id: storeId,
    tax_rate: input.taxRate ?? 16,
  };
}

function toCategoryUpdate(input: CategoryInput) {
  return {
    ...toDefaultMarkupPctColumn(input),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.taxRate !== undefined ? { tax_rate: input.taxRate } : {}),
  };
}

export async function listCategories(searchParams: URLSearchParams, storeId: string) {
  const { limit, skip } = parsePagination(searchParams);
  // Recortado y sin caracteres de control, como la búsqueda de productos.
  const search = normalizeProductSearch(searchParams.get("search"));

  // Solo comodines: casaría con todas.
  if (isUnsearchableSearchTerm(searchParams.get("search"))) {
    return { items: [], limit, skip, total: 0 };
  }

  const supabase = await createRouteSupabaseClient();
  const isActive = searchParams.get("isActive");

  /** La consulta con sus filtros; `head` = solo el conteo, sin filas. */
  const buildFilteredQuery = (head: boolean) => {
    let query = supabase
      .from("categories")
      .select(categorySelect, listCountOptions(head))
      .eq("store_id", storeId);

    // Sin filtro: solo activas (selectores de producto/POS). Admin pasa isActive=true|false|all via query.
    if (isActive === null) {
      query = query.eq("is_active", true);
    } else if (isActive.toLowerCase() !== "all") {
      query = query.eq("is_active", isActive.toLowerCase() === "true");
    }

    if (search) {
      query = query.ilike("name", `%${escapeIlike(search)}%`);
    }

    return query;
  };

  const { count, data, error, status } = await buildFilteredQuery(false)
    .order("name", { ascending: true })
    .range(skip, skip + limit - 1);

  // Página más allá del total: no es un error, es una página vacía con el total real.
  if (isRangeNotSatisfiable(error, status)) {
    const total = await buildFilteredQuery(true);

    throwIfSupabaseError(total.error);

    return { items: [], limit, skip, total: total.count ?? 0 };
  }

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapCategoryWithTaxRate(row as CategoryWithTaxRateRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getCategoryById(id: string, storeId: string) {
  await assertSupabaseStoreResource("categories", id, storeId, "Categoria no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .select(categorySelect)
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle<CategoryWithTaxRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return mapCategoryWithTaxRate(data);
}

export async function createCategory(input: CategoryInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .insert(toCategoryInsert(input, storeId))
    .select(categorySelect)
    .single<CategoryWithTaxRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la categoria.");
  }

  return mapCategoryWithTaxRate(data);
}

export async function updateCategory(id: string, input: CategoryInput, storeId: string) {
  await assertSupabaseStoreResource("categories", id, storeId, "Categoria no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .update(toCategoryUpdate(input))
    .eq("id", id)
    .eq("store_id", storeId)
    .select(categorySelect)
    .maybeSingle<CategoryWithTaxRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return mapCategoryWithTaxRate(data);
}

export async function deleteCategory(id: string, storeId: string) {
  await assertSupabaseStoreResource("categories", id, storeId, "Categoria no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ is_active: false })
    .eq("id", id)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .select(categorySelect)
    .maybeSingle<CategoryWithTaxRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return {
    ...mapCategoryWithTaxRate(data),
    deleted: true,
  };
}
