"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";
import { taxRatesQueryKeys } from "@/shared/hooks/useTaxRates";

import type {
  CreateTaxRateInput,
  TaxRate,
  UpdateTaxRateInput,
} from "../services/taxRates.schemas";

/**
 * El catálogo cambia (y una alícuota global que se toca pasa a ser una copia de
 * la tienda, con otro `id`): se vuelve a pedir en todas sus variantes.
 */
function invalidateTaxRates(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: taxRatesQueryKeys.all });
}

/** Alta de una alícuota propia de la tienda (`POST /api/tax-rates`, solo admin). */
export function useCreateTaxRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaxRateInput) =>
      apiFetch<TaxRate>("/api/tax-rates", { body: input, method: "POST" }),
    onSuccess: () => invalidateTaxRates(queryClient),
  });
}

export type UpdateTaxRateVariables = UpdateTaxRateInput & { id: string };

/**
 * Cambia una alícuota (`PATCH /api/tax-rates/[id]`, solo admin); aquí se usa
 * para activarla o desactivarla. Si el servidor se niega (la usa una categoría
 * activa o es la alícuota por defecto), el motivo llega en `error.message`.
 */
export function useUpdateTaxRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaxRateVariables) =>
      apiFetch<TaxRate>(`/api/tax-rates/${encodeURIComponent(id)}`, {
        body: input,
        method: "PATCH",
      }),
    onSuccess: () => invalidateTaxRates(queryClient),
  });
}
