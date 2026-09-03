import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { getCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.server";

import {
  composeStoreCapital,
  type StoreCapitalComponents,
  type StoreCapitalSummary,
} from "./capital";

type CapitalRow = {
  cuentas_por_cobrar_ref: number | string | null;
  cuentas_por_pagar_ref: number | string | null;
  inventario_costo_ref: number | string | null;
  store_id: string;
  vault_balance_efectivo_ves: number | string | null;
  vault_balance_ref: number | string | null;
  vault_balance_ves: number | string | null;
};

const EMPTY: StoreCapitalComponents = {
  cuentasPorCobrarRef: 0,
  cuentasPorPagarRef: 0,
  inventarioCostoRef: 0,
  vaultCuentaVes: 0,
  vaultEfectivoVes: 0,
  vaultRef: 0,
};

function toComponents(row: CapitalRow): StoreCapitalComponents {
  return {
    cuentasPorCobrarRef: Number(row.cuentas_por_cobrar_ref ?? 0),
    cuentasPorPagarRef: Number(row.cuentas_por_pagar_ref ?? 0),
    inventarioCostoRef: Number(row.inventario_costo_ref ?? 0),
    vaultCuentaVes: Number(row.vault_balance_ves ?? 0),
    vaultEfectivoVes: Number(row.vault_balance_efectivo_ves ?? 0),
    vaultRef: Number(row.vault_balance_ref ?? 0),
  };
}

/**
 * Lee la vista `store_capital_summary` (parche
 * `supabase/patches/20260902-store-capital-summary.sql`).
 */
export async function getStoreCapitalSummary(
  storeIds: string[],
  options?: { useAdmin?: boolean },
): Promise<StoreCapitalSummary[]> {
  if (storeIds.length === 0) {
    return [];
  }

  const supabase = options?.useAdmin
    ? createAdminSupabaseClient()
    : await createRouteSupabaseClient();

  const { data, error } = await supabase
    .from("store_capital_summary")
    .select("*")
    .in("store_id", storeIds);

  throwIfSupabaseError(error);

  const byStore = new Map(
    (data ?? []).map((row) => [(row as CapitalRow).store_id, toComponents(row as CapitalRow)]),
  );

  const rates = await Promise.all(
    storeIds.map(async (storeId) => {
      try {
        return (await getCurrentExchangeRate(storeId))?.rateVes ?? 0;
      } catch {
        return 0;
      }
    }),
  );

  return storeIds.map((storeId, index) =>
    composeStoreCapital({
      components: byStore.get(storeId) ?? EMPTY,
      rateVes: rates[index] ?? 0,
      storeId,
    }),
  );
}
