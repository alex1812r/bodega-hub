import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import { DOLAR_API_OFFICIAL_SOURCE } from "@/lib/exchange-rates/constants";
import { toAmericaCaracasDateKey } from "@/lib/exchange-rates/dateCaracas";
import { fetchOfficialDollarRate } from "@/lib/exchange-rates/dolarApi";
import {
  clearOfficialRateCache,
  getCachedOfficialRate,
  setCachedOfficialRate,
} from "@/lib/exchange-rates/officialRateCache";
import { mapExchangeRate, type ExchangeRateRow } from "@/lib/supabase/mappers/settings";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { ExchangeRateMock } from "@/shared/mocks/erp-data";

const exchangeRateSelect = "id, rate_ves, source, notes, created_at";

const RATE_EPSILON = 0.0001;

export async function listExchangeRates(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase
    .from("exchange_rates")
    .select(exchangeRateSelect, { count: "exact" })
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (from) {
    query = query.gte("created_at", `${from}T00:00:00.000Z`);
  }

  if (to) {
    query = query.lte("created_at", `${to}T23:59:59.999Z`);
  }

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapExchangeRate(row as ExchangeRateRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

function ratesDiffer(previous: number, next: number) {
  return Math.abs(previous - next) >= RATE_EPSILON;
}

async function getLastOfficialRateRow(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select(exchangeRateSelect)
    .eq("source", DOLAR_API_OFFICIAL_SOURCE)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ExchangeRateRow>();

  throwIfSupabaseError(error);

  return data;
}

async function persistOfficialRateIfNeeded(
  official: Awaited<ReturnType<typeof fetchOfficialDollarRate>>,
  storeId: string,
): Promise<ExchangeRateMock> {
  const last = await getLastOfficialRateRow(storeId);
  const officialDayKey = toAmericaCaracasDateKey(official.fechaActualizacion);
  const lastDayKey = last ? toAmericaCaracasDateKey(last.created_at) : null;
  const lastRate = last ? Number(last.rate_ves) : null;

  const shouldInsert =
    !last ||
    lastDayKey !== officialDayKey ||
    (lastRate !== null && ratesDiffer(lastRate, official.rateVes));

  if (!shouldInsert && last) {
    return mapExchangeRate(last);
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("exchange_rates")
    .insert({
      created_by: null,
      notes: `fechaActualizacion=${official.fechaActualizacion}`,
      rate_ves: official.rateVes,
      source: official.source,
      store_id: storeId,
    })
    .select(exchangeRateSelect)
    .single<ExchangeRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar la tasa oficial.");
  }

  return mapExchangeRate(data);
}

function toLiveExchangeRate(
  official: Awaited<ReturnType<typeof fetchOfficialDollarRate>>,
): ExchangeRateMock {
  return {
    createdAt: new Date(official.fechaActualizacion).toISOString(),
    id: "live-official",
    rateVes: official.rateVes,
    source: official.source,
  };
}

export async function getCurrentExchangeRate(storeId: string) {
  const cached = getCachedOfficialRate();

  if (cached) {
    return cached;
  }

  const official = await fetchOfficialDollarRate();

  let rate: ExchangeRateMock;

  try {
    rate = await persistOfficialRateIfNeeded(official, storeId);
  } catch {
    rate = toLiveExchangeRate(official);
  }

  setCachedOfficialRate(rate);

  return rate;
}

export async function createExchangeRate(
  input: { rateVes: number; source?: string },
  storeId: string,
) {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  throwIfSupabaseError(userError);

  const { data, error } = await supabase
    .from("exchange_rates")
    .insert({
      created_by: user?.id ?? null,
      rate_ves: input.rateVes,
      source: input.source ?? "Manual",
      store_id: storeId,
    })
    .select(exchangeRateSelect)
    .single<ExchangeRateRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la tasa de cambio.");
  }

  clearOfficialRateCache();

  return mapExchangeRate(data);
}

export { clearOfficialRateCache };
