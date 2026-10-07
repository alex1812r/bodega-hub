import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  TAX_RATE_CODE_NOT_DERIVABLE_MESSAGE,
  TAX_RATE_NOT_FOUND_MESSAGE,
  buildTaxRateCode,
  buildTaxRateCodeTakenMessage,
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
const TAX_RATE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Todo el cambio lo hace la RPC `override_tax_rate_for_store` (parche 20261007b)
 * en una transaccion: actualiza la fila de la tienda o, si la alicuota es global,
 * crea la fila propia y le traspasa categorias y alicuota por defecto. Tambien
 * decide los rechazos: 404 si la tienda no ve la alicuota y 409 si se desactiva
 * una en uso. La tienda es la de la sesion (`assert_store_context`).
 */
export async function updateTaxRate(
  id: string,
  input: UpdateTaxRateInput,
  storeId: string,
): Promise<TaxRate> {
  // Un id que no es uuid no puede existir: mismo 404, sin llegar a la base.
  if (!TAX_RATE_ID_PATTERN.test(id)) {
    throw new ApiError(404, "NOT_FOUND", TAX_RATE_NOT_FOUND_MESSAGE);
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("override_tax_rate_for_store", {
    p_is_active: input.isActive ?? null,
    p_label: input.label ?? null,
    p_pct: input.pct === undefined ? null : normalizeTaxRatePct(input.pct),
    p_sort_order: input.sortOrder ?? null,
    p_tax_rate_id: id,
  });

  throwIfSupabaseError(error);

  const row = data as TaxRateRow | null;

  if (!row?.id) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo guardar la alicuota de IVA.");
  }

  return mapTaxRate(row, await loadDefaultTaxRateId(supabase, storeId));
}
