import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type {
  CreateStoreInput,
  PlatformStore,
  PlatformStoreDetail,
  PlatformStoreUser,
  UpdateStoreInput,
} from "../types/stores";

type StoreRow = {
  created_at: string;
  id: string;
  name: string;
  notes: string | null;
  slug: string;
  status: "active" | "paused";
};

function toStore(row: StoreRow, usersCount = 0): PlatformStore {
  return {
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    notes: row.notes,
    slug: row.slug,
    status: row.status,
    usersCount,
  };
}

async function loadStore(id: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("stores").select("*").eq("id", id).maybeSingle<StoreRow>();
  throwIfSupabaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Tienda no encontrada.");
  return data;
}

export async function listStores(searchParams: URLSearchParams) {
  const admin = createAdminSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status");
  let query = admin.from("stores").select("*", { count: "exact" });
  if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  if (status === "active" || status === "paused") query = query.eq("status", status);
  const { count, data, error } = await query.order("created_at", { ascending: false }).range(skip, skip + limit - 1);
  throwIfSupabaseError(error);
  const rows = (data ?? []) as StoreRow[];
  const ids = rows.map((row) => row.id);
  const { data: profiles, error: profilesError } = ids.length
    ? await admin.from("profiles").select("store_id").in("store_id", ids)
    : { data: [], error: null };
  throwIfSupabaseError(profilesError);
  const counts = new Map<string, number>();
  for (const profile of profiles ?? []) {
    const storeId = (profile as { store_id: string }).store_id;
    counts.set(storeId, (counts.get(storeId) ?? 0) + 1);
  }
  return { items: rows.map((row) => toStore(row, counts.get(row.id) ?? 0)), limit, skip, total: count ?? 0 };
}

export async function getStore(id: string): Promise<PlatformStoreDetail> {
  const admin = createAdminSupabaseClient();
  const store = await loadStore(id);
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("store_id", id)
    .order("full_name");
  throwIfSupabaseError(error);
  const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  throwIfSupabaseError(authUsers.error);
  const emails = new Map(authUsers.data.users.map((user) => [user.id, user.email ?? ""]));
  const users: PlatformStoreUser[] = (profiles ?? []).map((profile) => {
    const row = profile as { full_name: string | null; id: string; is_active: boolean; role: string };
    return { email: emails.get(row.id) ?? "", id: row.id, isActive: row.is_active, name: row.full_name ?? "Usuario", role: row.role };
  });
  return { ...toStore(store, users.length), users };
}

export async function createStore(input: CreateStoreInput) {
  const routeClient = await createRouteSupabaseClient();
  const { data: actor } = await routeClient.auth.getUser();
  const admin = createAdminSupabaseClient();
  let storeId: string | undefined;
  let userId: string | undefined;
  try {
    const { data: store, error: storeError } = await admin
      .from("stores")
      .insert({ created_by: actor.user?.id ?? null, name: input.name, notes: input.notes ?? null, slug: input.slug, status: input.status ?? "active" })
      .select("*")
      .single<StoreRow>();
    throwIfSupabaseError(storeError);
    if (!store) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la tienda.");
    storeId = store.id;
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: input.admin.email,
      email_confirm: true,
      password: input.admin.password,
      user_metadata: { full_name: input.admin.fullName },
    });
    throwIfSupabaseError(authError);
    if (!auth.user) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el administrador.");
    userId = auth.user.id;
    const { error: profileError } = await admin.from("profiles").upsert({
      full_name: input.admin.fullName,
      id: userId,
      is_active: true,
      role: "admin",
      store_id: storeId,
    });
    throwIfSupabaseError(profileError);
    const { error: settingsError } = await admin.from("app_settings").insert({
      business_name: input.name,
      default_tax_rate: 0,
      id: 1,
      invoice_prefix: "FAC",
      low_stock_threshold: 5,
      store_id: storeId,
    });
    throwIfSupabaseError(settingsError);
    return getStore(storeId);
  } catch (error) {
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (storeId) await admin.from("stores").delete().eq("id", storeId);
    throw error;
  }
}

export async function updateStore(id: string, input: UpdateStoreInput) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("stores").update({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  }).eq("id", id).select("*").maybeSingle<StoreRow>();
  throwIfSupabaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Tienda no encontrada.");
  return getStore(id);
}
