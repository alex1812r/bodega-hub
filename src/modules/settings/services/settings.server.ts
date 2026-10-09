import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import {
  mapAppSettings,
  mapPricingSettings,
  mapUserProfile,
  type AppSettingsRow,
  type PricingSettingsRow,
  type ProfileListRow,
} from "@/lib/supabase/mappers/settings";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { isStoreUserRole } from "@/shared/auth/permissions";

import {
  CASH_CLOSE_DIFF_ALERT_UNAVAILABLE_MESSAGE,
  mapCashCloseDiffAlertVes,
  parseCashCloseDiffAlertVes,
  type CashCloseSettings,
} from "./cashCloseSettings.schemas";
import type { CreateStoreUserInput } from "./createStoreUserSchema";
import { parsePricingSettings, type PricingSettings } from "./pricingSettings.schemas";
import type { SettingsInput, UserProfileInput } from "./settings.mock-server";
import { DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE } from "./taxRates.schemas";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

const pricingSettingsSelect = "margin_yellow_from_pct, margin_green_from_pct, markup_chips_pct";

/** Umbral de aviso de faltante al cerrar caja (parche 20261015a). */
const cashCloseDiffAlertColumn = "cash_close_diff_alert_ves";

/** Lo que una base SIN el parche 20261015a sabe responder. */
const appSettingsBaseSelect = `id, business_name, default_tax_rate, default_tax_rate_id, invoice_prefix, low_stock_threshold, enabled_payment_methods, ${pricingSettingsSelect}`;

const appSettingsSelect = `${appSettingsBaseSelect}, ${cashCloseDiffAlertColumn}`;

type CashCloseSettingsRow = { cash_close_diff_alert_ves?: number | string | null };

type AppSettingsWithTaxRateRow = AppSettingsRow &
  PricingSettingsRow &
  CashCloseSettingsRow & { default_tax_rate_id?: string | null };

/**
 * Configuracion con su alicuota de IVA por defecto (`tax_rates.id`), los
 * ajustes de precios (semaforo y chips) y el umbral de faltante al cerrar caja
 * (0 si la base aun no tiene la columna).
 */
function mapAppSettingsWithTaxRate(row: AppSettingsWithTaxRateRow) {
  return {
    ...mapAppSettings(row),
    cashCloseDiffAlertVes: mapCashCloseDiffAlertVes(row.cash_close_diff_alert_ves),
    defaultTaxRateId: row.default_tax_rate_id ?? undefined,
    pricing: mapPricingSettings(row),
  };
}

/**
 * La base aun no tiene `app_settings.cash_close_diff_alert_ves` (parche
 * 20261015a sin aplicar): Postgres responde 42703 al leerla y PostgREST
 * PGRST204 al escribirla. Solo cuenta si el error nombra ESA columna: la falta
 * de cualquier otra sigue siendo un error.
 */
function isMissingCashCloseColumn(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const message = "message" in error && typeof error.message === "string" ? error.message : "";

  return (
    (error.code === "42703" || error.code === "PGRST204") &&
    message.includes(cashCloseDiffAlertColumn)
  );
}

const profileSelect =
  "id, full_name, role, is_active, granted_permissions, denied_permissions";

function toPricingUpdate(pricing: PricingSettings) {
  return {
    margin_green_from_pct: pricing.greenFromPct,
    margin_yellow_from_pct: pricing.yellowFromPct,
    markup_chips_pct: pricing.chipsPct,
  };
}

function toSettingsUpdate(input: SettingsInput) {
  // Con alicuota por defecto manda ella: el trigger de 20261007a copia su
  // porcentaje a default_tax_rate, asi que el numero suelto no se envia.
  const defaultTaxRate =
    input.defaultTaxRateId != null
      ? { default_tax_rate_id: input.defaultTaxRateId }
      : input.defaultTaxRate !== undefined
        ? { default_tax_rate: input.defaultTaxRate }
        : {};

  return {
    ...(input.businessName !== undefined ? { business_name: input.businessName } : {}),
    ...defaultTaxRate,
    ...(input.pricing !== undefined ? toPricingUpdate(parsePricingSettings(input.pricing)) : {}),
    ...(input.invoicePrefix !== undefined ? { invoice_prefix: input.invoicePrefix } : {}),
    ...(input.lowStockThreshold !== undefined ? { low_stock_threshold: input.lowStockThreshold } : {}),
    ...(input.cashCloseDiffAlertVes !== undefined
      ? { [cashCloseDiffAlertColumn]: parseCashCloseDiffAlertVes(input.cashCloseDiffAlertVes) }
      : {}),
    ...(input.enabledPaymentMethods !== undefined
      ? { enabled_payment_methods: input.enabledPaymentMethods }
      : {}),
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
  const read = (columns: string) =>
    supabase
      .from("app_settings")
      .select(columns)
      .eq("store_id", storeId)
      .maybeSingle<AppSettingsWithTaxRateRow>();

  let { data, error } = await read(appSettingsSelect);

  // Base sin el parche 20261015a: el resto de la configuracion se lee igual y el umbral vale 0.
  if (isMissingCashCloseColumn(error)) {
    ({ data, error } = await read(appSettingsBaseSelect));
  }

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Configuracion no encontrada.");
  }

  return mapAppSettingsWithTaxRate(data);
}

/**
 * Ajustes de precios de la tienda (semaforo de ganancia y chips de %). Una
 * tienda sin fila de configuracion usa los por defecto de `@bodega/core`: aqui
 * no hay 404, porque el listado y el bloque de precio deben funcionar siempre.
 */
export async function getPricingSettings(storeId: string): Promise<PricingSettings> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select(pricingSettingsSelect)
    .eq("store_id", storeId)
    .maybeSingle<PricingSettingsRow>();

  throwIfSupabaseError(error);

  return mapPricingSettings(data);
}

/**
 * Umbral de faltante al cerrar caja de la tienda. Sin fila de configuracion o
 * sin la columna (parche 20261015a sin aplicar) vale 0: cualquier faltante pide
 * confirmacion, y el cierre de caja nunca se queda sin poder abrirse por esto.
 */
export async function getCashCloseSettings(storeId: string): Promise<CashCloseSettings> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select(cashCloseDiffAlertColumn)
    .eq("store_id", storeId)
    .maybeSingle<CashCloseSettingsRow>();

  if (!isMissingCashCloseColumn(error)) {
    throwIfSupabaseError(error);
  }

  return { cashCloseDiffAlertVes: mapCashCloseDiffAlertVes(data?.cash_close_diff_alert_ves) };
}

/**
 * La alicuota por defecto debe ser una de las que la tienda ve HOY (propia, o
 * global que no haya redefinido) y estar activa. El trigger de la base solo
 * comprueba que sea de la tienda: una inactiva la rechaza el BFF.
 */
async function assertActiveStoreTaxRate(
  supabase: RouteSupabaseClient,
  taxRateId: string,
  storeId: string,
) {
  const { data, error } = await supabase.rpc("tax_rates_for_store", { p_store_id: storeId });

  throwIfSupabaseError(error);

  const rates = (data ?? []) as Array<{ id: string; is_active: boolean }>;

  if (!rates.some((rate) => rate.id === taxRateId && rate.is_active)) {
    throw new ApiError(400, "BAD_REQUEST", DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE);
  }
}

export async function updateSettings(input: SettingsInput, storeId: string) {
  // Se valida antes de abrir ninguna consulta: unos ajustes inválidos no llegan a la base.
  const settingsUpdate = toSettingsUpdate(input);
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  throwIfSupabaseError(userError);

  if (input.defaultTaxRateId != null) {
    await assertActiveStoreTaxRate(supabase, input.defaultTaxRateId, storeId);
  }

  const write = (columns: string) =>
    supabase
      .from("app_settings")
      .update({
        ...settingsUpdate,
        updated_by: user?.id ?? null,
      })
      .eq("store_id", storeId)
      .select(columns)
      .maybeSingle<AppSettingsWithTaxRateRow>();

  let { data, error } = await write(appSettingsSelect);

  // Base sin el parche 20261015a. La sentencia fallo entera (no escribio nada):
  // si lo que se queria guardar era el umbral, se dice; si no, se repite sin leerlo.
  if (isMissingCashCloseColumn(error)) {
    if (cashCloseDiffAlertColumn in settingsUpdate) {
      throw new ApiError(409, "CONFLICT", CASH_CLOSE_DIFF_ALERT_UNAVAILABLE_MESSAGE);
    }

    ({ data, error } = await write(appSettingsBaseSelect));
  }

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Configuracion no encontrada.");
  }

  return mapAppSettingsWithTaxRate(data);
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
  if (input.role !== undefined && !isStoreUserRole(input.role)) {
    throw new ApiError(400, "BAD_REQUEST", "Rol no permitido para usuarios de tienda.");
  }

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

export async function createUser(input: CreateStoreUserInput, storeId: string) {
  if (!isStoreUserRole(input.role)) {
    throw new ApiError(400, "BAD_REQUEST", "Rol no permitido para usuarios de tienda.");
  }

  const admin = createAdminSupabaseClient();
  let userId: string | undefined;

  try {
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: input.email.trim().toLowerCase(),
      email_confirm: true,
      password: input.password,
      user_metadata: {
        full_name: input.fullName.trim(),
        role: input.role,
        store_id: storeId,
      },
    });
    throwIfSupabaseError(authError);

    if (!auth.user) {
      throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el usuario.");
    }

    userId = auth.user.id;

    const { error: profileError } = await admin.from("profiles").upsert({
      full_name: input.fullName.trim(),
      id: userId,
      is_active: true,
      role: input.role,
      store_id: storeId,
    });
    throwIfSupabaseError(profileError);

    const { data: profile, error: loadError } = await admin
      .from("profiles")
      .select(profileSelect)
      .eq("id", userId)
      .maybeSingle<ProfileListRow>();
    throwIfSupabaseError(loadError);

    if (!profile) {
      throw new ApiError(500, "INTERNAL_ERROR", "No se pudo cargar el perfil creado.");
    }

    return mapUserProfile(profile, auth.user.email ?? input.email);
  } catch (error) {
    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    throw error;
  }
}
