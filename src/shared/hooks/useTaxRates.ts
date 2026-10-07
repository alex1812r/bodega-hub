import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { TaxRate, TaxRateList } from "@/modules/settings/services/taxRates.schemas";
import { apiFetch } from "@/shared/api/apiFetch";

export type { TaxRate };

/** El catalogo de alicuotas cambia muy poco: solo desde Configuracion. */
export const TAX_RATES_STALE_TIME_MS = 5 * 60 * 1000;

const PCT_TOLERANCE = 0.0001;
const EMPTY_RATES: TaxRate[] = [];

/** Claves de cache: invalidar `all` tras crear, editar o desactivar una alicuota. */
export const taxRatesQueryKeys = {
  all: ["tax-rates"] as const,
  list: (activeOnly: boolean) => ["tax-rates", "list", { activeOnly }] as const,
};

type UseTaxRatesOptions = {
  activeOnly?: boolean;
};

export function useTaxRates({ activeOnly = true }: UseTaxRatesOptions = {}) {
  const query = useQuery({
    queryFn: () =>
      apiFetch<TaxRateList>("/api/tax-rates", {
        query: activeOnly ? { active: "true" } : undefined,
      }),
    queryKey: taxRatesQueryKeys.list(activeOnly),
    staleTime: TAX_RATES_STALE_TIME_MS,
  });
  const rates = query.data?.items ?? EMPTY_RATES;
  const { error, isLoading, refetch } = query;

  return useMemo(() => {
    function byCode(code: string | null | undefined) {
      return code ? (rates.find((rate) => rate.code === code) ?? null) : null;
    }

    /** Si varias alicuotas comparten porcentaje gana la activa. */
    function byPct(pct: number) {
      const matches = rates.filter((rate) => Math.abs(rate.pct - pct) < PCT_TOLERANCE);

      return matches.find((rate) => rate.isActive) ?? matches[0] ?? null;
    }

    return {
      byCode,
      byPct,
      defaultRate: rates.find((rate) => rate.isDefault) ?? null,
      error,
      isLoading,
      rates,
      refetch,
    };
  }, [error, isLoading, rates, refetch]);
}
