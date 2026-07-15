import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import { mapCategory, type CategoryRow } from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { CategoryInput } from "./categories.mock-server";

const categorySelect = "id, name, description, is_active, created_at, updated_at";

function toCategoryInsert(input: CategoryInput) {
  return {
    description: input.description ?? null,
    name: input.name ?? "Categoria",
  };
}

function toCategoryUpdate(input: CategoryInput) {
  return {
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
  };
}

export async function listCategories(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const search = searchParams.get("search")?.trim();
  const isActive = searchParams.get("isActive");

  let query = supabase
    .from("categories")
    .select(categorySelect, { count: "exact" })
    .order("name", { ascending: true });

  // Sin filtro: solo activas (selectores de producto/POS). Admin pasa isActive=true|false|all via query.
  if (isActive === null) {
    query = query.eq("is_active", true);
  } else if (isActive.toLowerCase() !== "all") {
    query = query.eq("is_active", isActive.toLowerCase() === "true");
  }

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapCategory(row as CategoryRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getCategoryById(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .select(categorySelect)
    .eq("id", id)
    .maybeSingle<CategoryRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return mapCategory(data);
}

export async function createCategory(input: CategoryInput) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .insert(toCategoryInsert(input))
    .select(categorySelect)
    .single<CategoryRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la categoria.");
  }

  return mapCategory(data);
}

export async function updateCategory(id: string, input: CategoryInput) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .update(toCategoryUpdate(input))
    .eq("id", id)
    .select(categorySelect)
    .maybeSingle<CategoryRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return mapCategory(data);
}

export async function deleteCategory(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ is_active: false })
    .eq("id", id)
    .eq("is_active", true)
    .select(categorySelect)
    .maybeSingle<CategoryRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return {
    ...mapCategory(data),
    deleted: true,
  };
}
