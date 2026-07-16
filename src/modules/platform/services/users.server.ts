import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

import type { CreateStoreAdminInput, PlatformUser, PlatformUserDetail } from "../types/users";

type ProfileRow = {
  denied_permissions: unknown;
  full_name: string | null;
  granted_permissions: unknown;
  id: string;
  is_active: boolean;
  role: string;
  store_id: string | null;
};

type StoreRow = {
  id: string;
  name: string;
  slug: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapUser(
  profile: ProfileRow,
  email: string,
  storesById: Map<string, StoreRow>,
): PlatformUser {
  const store = profile.store_id ? storesById.get(profile.store_id) : undefined;

  return {
    email,
    id: profile.id,
    isActive: profile.is_active,
    name: profile.full_name ?? email ?? "Usuario",
    role: profile.role,
    store: store
      ? { id: store.id, name: store.name, slug: store.slug }
      : profile.store_id
        ? { id: profile.store_id, name: "Tienda", slug: "-" }
        : null,
  };
}

export async function listPlatformUsers(searchParams: URLSearchParams) {
  const admin = createAdminSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const search = searchParams.get("search")?.trim().toLowerCase();
  const storeId = searchParams.get("storeId");
  const role = searchParams.get("role");

  let profilesQuery = admin
    .from("profiles")
    .select("id, full_name, role, is_active, store_id, granted_permissions, denied_permissions")
    .neq("role", "superadmin");

  if (storeId) {
    profilesQuery = profilesQuery.eq("store_id", storeId);
  }
  if (role) {
    profilesQuery = profilesQuery.eq("role", role);
  }

  const { data: profiles, error } = await profilesQuery.order("full_name");
  throwIfSupabaseError(error);

  const storeIds = [
    ...new Set(
      (profiles ?? [])
        .map((row) => (row as ProfileRow).store_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: stores, error: storesError } = storeIds.length
    ? await admin.from("stores").select("id, name, slug").in("id", storeIds)
    : { data: [], error: null };
  throwIfSupabaseError(storesError);

  const storesById = new Map((stores ?? []).map((store) => [store.id, store as StoreRow]));
  const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  throwIfSupabaseError(authUsers.error);
  const emails = new Map(authUsers.data.users.map((user) => [user.id, user.email ?? ""]));

  let items = ((profiles ?? []) as ProfileRow[]).map((profile) =>
    mapUser(profile, emails.get(profile.id) ?? "", storesById),
  );

  if (search) {
    items = items.filter((user) =>
      `${user.name} ${user.email} ${user.store?.name ?? ""} ${user.store?.slug ?? ""}`
        .toLowerCase()
        .includes(search),
    );
  }

  const total = items.length;
  const page = items.slice(skip, skip + limit);

  return { items: page, limit, skip, total };
}

export async function getPlatformUser(id: string): Promise<PlatformUserDetail> {
  const admin = createAdminSupabaseClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, full_name, role, is_active, store_id, granted_permissions, denied_permissions")
    .eq("id", id)
    .maybeSingle<ProfileRow>();
  throwIfSupabaseError(error);

  if (!profile || profile.role === "superadmin") {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(id);
  throwIfSupabaseError(authError);

  let store: StoreRow | null = null;
  if (profile.store_id) {
    const { data, error: storeError } = await admin
      .from("stores")
      .select("id, name, slug")
      .eq("id", profile.store_id)
      .maybeSingle<StoreRow>();
    throwIfSupabaseError(storeError);
    store = data;
  }

  const storesById = new Map(store ? [[store.id, store]] : []);
  const user = mapUser(profile, authUser.user?.email ?? "", storesById);

  return {
    ...user,
    deniedPermissions: asStringArray(profile.denied_permissions),
    grantedPermissions: asStringArray(profile.granted_permissions),
  };
}

export async function createStoreAdmin(input: CreateStoreAdminInput): Promise<PlatformUserDetail> {
  const admin = createAdminSupabaseClient();

  const { data: store, error: storeError } = await admin
    .from("stores")
    .select("id, name, slug")
    .eq("id", input.storeId)
    .maybeSingle<StoreRow>();
  throwIfSupabaseError(storeError);
  if (!store) {
    throw new ApiError(404, "NOT_FOUND", "Tienda no encontrada.");
  }

  let userId: string | undefined;
  try {
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      password: input.password,
      user_metadata: { full_name: input.fullName, role: "admin", store_id: input.storeId },
    });
    throwIfSupabaseError(authError);
    if (!auth.user) {
      throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el administrador.");
    }
    userId = auth.user.id;

    const { error: profileError } = await admin.from("profiles").upsert({
      full_name: input.fullName,
      id: userId,
      is_active: true,
      role: "admin",
      store_id: input.storeId,
    });
    throwIfSupabaseError(profileError);

    return getPlatformUser(userId);
  } catch (error) {
    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    throw error;
  }
}
