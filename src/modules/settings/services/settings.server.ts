import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import {
  mapAppSettings,
  mapUserProfile,
  type AppSettingsRow,
  type ProfileListRow,
} from "@/lib/supabase/mappers/settings";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { SettingsInput, UserProfileInput } from "./settings.mock-server";

const APP_SETTINGS_ID = 1;

const appSettingsSelect =
  "id, business_name, default_tax_rate, invoice_prefix, low_stock_threshold";

const profileSelect =
  "id, full_name, role, is_active, granted_permissions, denied_permissions";

function toSettingsUpdate(input: SettingsInput) {
  return {
    ...(input.businessName !== undefined ? { business_name: input.businessName } : {}),
    ...(input.defaultTaxRate !== undefined ? { default_tax_rate: input.defaultTaxRate } : {}),
    ...(input.invoicePrefix !== undefined ? { invoice_prefix: input.invoicePrefix } : {}),
    ...(input.lowStockThreshold !== undefined ? { low_stock_threshold: input.lowStockThreshold } : {}),
  };
}

function toProfileUpdate(input: UserProfileInput) {
  return {
    ...(input.name !== undefined ? { full_name: input.name } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.grantedPermissions !== undefined
      ? { granted_permissions: input.grantedPermissions }
      : {}),
    ...(input.deniedPermissions !== undefined
      ? { denied_permissions: input.deniedPermissions }
      : {}),
  };
}

async function loadAuthEmailsById() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  throwIfSupabaseError(error);

  return new Map(
    (data.users ?? []).map((user) => [user.id, user.email ?? ""]),
  );
}

export async function getSettings(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select(appSettingsSelect)
    .eq("store_id", storeId)
    .maybeSingle<AppSettingsRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Configuracion no encontrada.");
  }

  return mapAppSettings(data);
}

export async function updateSettings(input: SettingsInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  throwIfSupabaseError(userError);

  const { data, error } = await supabase
    .from("app_settings")
    .update({
      ...toSettingsUpdate(input),
      updated_by: user?.id ?? null,
    })
    .eq("store_id", storeId)
    .select(appSettingsSelect)
    .maybeSingle<AppSettingsRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Configuracion no encontrada.");
  }

  return mapAppSettings(data);
}

export async function listUsers(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  const { count, data, error } = await supabase
    .from("profiles")
    .select(profileSelect, { count: "exact" })
    .eq("store_id", storeId)
    .order("full_name", { ascending: true, nullsFirst: false })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  const emailsById = await loadAuthEmailsById();

  return {
    items: (data ?? []).map((row) =>
      mapUserProfile(row as ProfileListRow, emailsById.get(row.id) ?? ""),
    ),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function updateUser(id: string, input: UserProfileInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(toProfileUpdate(input))
    .eq("id", id)
    .eq("store_id", storeId)
    .select(profileSelect)
    .maybeSingle<ProfileListRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  const emailsById = await loadAuthEmailsById();

  return mapUserProfile(data, emailsById.get(data.id) ?? "");
}
