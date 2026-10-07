import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  TAX_RATE_CODE_NOT_DERIVABLE_MESSAGE,
  TAX_RATE_NOT_FOUND_MESSAGE,
  buildTaxRateCode,
  buildTaxRateCodeTakenMessage,
  buildTaxRateInUseMessage,
  compareTaxRates,
  nextTaxRateSortOrder,
  normalizeTaxRatePct,
  type CreateTaxRateInput,
  type TaxRate,
  type TaxRateList,
  type TaxRateListFilters,
  type UpdateTaxRateInput,
} from "./taxRates.schemas";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

type TaxRateRow = {
  code: string;
  id: string;
  is_active: boolean;
  label: string;
  pct: number | string;
  sort_order: number;
  store_id: string | null;
};

const taxRateSelect = "id, store_id, code, label, pct, is_active, sort_order";

function mapTaxRate(row: TaxRateRow, defaultTaxRateId: string | null): TaxRate {
  return {
    code: row.code,
    id: row.id,
    isActive: row.is_active,
    isDefault: row.id === defaultTaxRateId,
    isGlobal: row.store_id === null,
    label: row.label,
    pct: Number(row.pct),
    sortOrder: row.sort_order,
  };
}

/** Alicuotas vigentes para la tienda: las suyas mas las globales que no redefinio. */
async function loadStoreTaxRates(supabase: RouteSupabaseClient, storeId: string) {
  const { data, error } = await supabase.rpc("tax_rates_for_store", { p_store_id: storeId });

  throwIfSupabaseError(error);

  return (data ?? []) as TaxRateRow[];
}

async function loadDefaultTaxRateId(supabase: RouteSupabaseClient, storeId: string) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("default_tax_rate_id")
    .eq("store_id", storeId)
    .maybeSingle<{ default_tax_rate_id: string | null }>();

  throwIfSupabaseError(error);

  return data?.default_tax_rate_id ?? null;
}

async function countActiveCategories(
  supabase: RouteSupabaseClient,
  storeId: string,
  taxRateId: string,
) {
  const { count, error } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("tax_rate_id", taxRateId)
    .eq("is_active", true);

  throwIfSupabaseError(error);

  return count ?? 0;
}

async function assertCanDeactivate(
  supabase: RouteSupabaseClient,
  storeId: string,
  row: TaxRateRow,
  defaultTaxRateId: string | null,
) {
  const message = buildTaxRateInUseMessage(
    row.label,
    await countActiveCategories(supabase, storeId, row.id),
    row.id === defaultTaxRateId,
  );

  if (message) {
    throw new ApiError(409, "CONFLICT", message);
  }
}

/**
 * La fila de la tienda manda sobre la global del mismo `code`: las categorias y
 * la alicuota por defecto de la tienda que apuntaban a la global pasan a la fila
 * propia (el trigger de cada tabla copia el porcentaje). Se repite en cada cambio
 * de una fila de tienda, asi un fallo a medias se corrige solo en el siguiente.
 * Devuelve el id de la alicuota por defecto tras el cambio.
 */
async function adoptGlobalReferences(
  supabase: RouteSupabaseClient,
  storeId: string,
  row: TaxRateRow,
  defaultTaxRateId: string | null,
) {
  const { data: global, error: globalError } = await supabase
    .from("tax_rates")
    .select("id")
    .is("store_id", null)
    .eq("code", row.code)
    .maybeSingle<{ id: string }>();

  throwIfSupabaseError(globalError);

  if (!global) {
    return defaultTaxRateId;
  }

  const { error: categoriesError } = await supabase
    .from("categories")
    .update({ tax_rate_id: row.id })
    .eq("store_id", storeId)
    .eq("tax_rate_id", global.id);

  throwIfSupabaseError(categoriesError);

  if (defaultTaxRateId !== global.id) {
    return defaultTaxRateId;
  }

  const { error: settingsError } = await supabase
    .from("app_settings")
    .update({ default_tax_rate_id: row.id })
    .eq("store_id", storeId)
    .eq("default_tax_rate_id", global.id);

  throwIfSupabaseError(settingsError);

  return row.id;
}

export async function listTaxRates(
  storeId: string,
  filters: TaxRateListFilters = {},
): Promise<TaxRateList> {
  const supabase = await createRouteSupabaseClient();
  const [rows, defaultTaxRateId] = await Promise.all([
    loadStoreTaxRates(supabase, storeId),
    loadDefaultTaxRateId(supabase, storeId),
  ]);

  return {
    items: rows
      .filter((row) => !filters.activeOnly || row.is_active)
      .map((row) => mapTaxRate(row, defaultTaxRateId))
      .sort(compareTaxRates),
  };
}

export async function createTaxRate(input: CreateTaxRateInput, storeId: string): Promise<TaxRate> {
  const supabase = await createRouteSupabaseClient();
  const visible = await loadStoreTaxRates(supabase, storeId);
  const code = input.code ?? buildTaxRateCode(input.label);

  if (!code) {
    throw new ApiError(400, "BAD_REQUEST", TAX_RATE_CODE_NOT_DERIVABLE_MESSAGE);
  }

  // Un code que ya ve la tienda (propio o global) no se crea desde aqui: crearlo
  // redefiniria la global en silencio. Eso solo pasa al cambiar la global (PATCH).
  if (visible.some((row) => row.code === code)) {
    throw new ApiError(409, "CONFLICT", buildTaxRateCodeTakenMessage(code));
  }

  const { data, error } = await supabase
    .from("tax_rates")
    .insert({
      code,
      label: input.label,
      pct: normalizeTaxRatePct(input.pct),
      sort_order: nextTaxRateSortOrder(visible.map((row) => ({ sortOrder: row.sort_order }))),
      store_id: storeId,
    })
    .select(taxRateSelect)
    .single<TaxRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la alicuota de IVA.");
  }

  return mapTaxRate(data, null);
}

export async function updateTaxRate(
  id: string,
  input: UpdateTaxRateInput,
  storeId: string,
): Promise<TaxRate> {
  const supabase = await createRouteSupabaseClient();
  const [rows, initialDefaultTaxRateId] = await Promise.all([
    loadStoreTaxRates(supabase, storeId),
    loadDefaultTaxRateId(supabase, storeId),
  ]);
  // Solo lo que ve la tienda: la alicuota de otra tienda, o una global que la
  // tienda ya redefinio, no existe para ella.
  const current = rows.find((row) => row.id === id);

  if (!current) {
    throw new ApiError(404, "NOT_FOUND", TAX_RATE_NOT_FOUND_MESSAGE);
  }

  const currentPct = Number(current.pct);
  const next = {
    is_active: input.isActive ?? current.is_active,
    label: input.label ?? current.label,
    pct: input.pct === undefined ? currentPct : normalizeTaxRatePct(input.pct),
    sort_order: input.sortOrder ?? current.sort_order,
  };

  if (current.store_id === null) {
    if (current.is_active && !next.is_active) {
      await assertCanDeactivate(supabase, storeId, current, initialDefaultTaxRateId);
    }

    const unchanged =
      next.is_active === current.is_active &&
      next.label === current.label &&
      next.pct === currentPct &&
      next.sort_order === current.sort_order;

    if (unchanged) {
      return mapTaxRate(current, initialDefaultTaxRateId);
    }

    // Las globales no se escriben desde la app (el RLS tampoco lo permite): la
    // tienda recibe su propia fila con el mismo code, que manda sobre la global.
    const { data: override, error } = await supabase
      .from("tax_rates")
      .insert({ ...next, code: current.code, store_id: storeId })
      .select(taxRateSelect)
      .single<TaxRateRow>();

    throwIfSupabaseError(error);

    if (!override) {
      throw new ApiError(500, "INTERNAL_ERROR", "No se pudo guardar la alicuota de IVA.");
    }

    return mapTaxRate(
      override,
      await adoptGlobalReferences(supabase, storeId, override, initialDefaultTaxRateId),
    );
  }

  const defaultTaxRateId = await adoptGlobalReferences(
    supabase,
    storeId,
    current,
    initialDefaultTaxRateId,
  );

  if (current.is_active && !next.is_active) {
    await assertCanDeactivate(supabase, storeId, current, defaultTaxRateId);
  }

  const { data, error } = await supabase
    .from("tax_rates")
    .update(next)
    .eq("id", id)
    .eq("store_id", storeId)
    .select(taxRateSelect)
    .maybeSingle<TaxRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", TAX_RATE_NOT_FOUND_MESSAGE);
  }

  return mapTaxRate(data, defaultTaxRateId);
}
