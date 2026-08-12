"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cashKeys } from "@/modules/cash/hooks/useCash";
import { apiFetch } from "@/shared/api/apiFetch";

import type { StoreVault, VaultMovement } from "../types";

export const vaultKeys = {
  all: ["vault"] as const,
  movements: ["vault", "movements"] as const,
};

export function useVault() {
  return useQuery({
    queryKey: vaultKeys.all,
    queryFn: () => apiFetch<StoreVault>("/api/vault"),
  });
}

export function useVaultMovements() {
  return useQuery({
    queryKey: vaultKeys.movements,
    queryFn: () => apiFetch<VaultMovement[]>("/api/vault/movements"),
  });
}

function useInvalidateVaultQueries() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: vaultKeys.all });
    void queryClient.invalidateQueries({ queryKey: vaultKeys.movements });
    void queryClient.invalidateQueries({ queryKey: cashKeys.all });
    void queryClient.invalidateQueries({ queryKey: cashKeys.pendingClosures });
  };
}

export function useVaultDeposit() {
  const invalidate = useInvalidateVaultQueries();

  return useMutation({
    mutationFn: (body: { amountRef: number; amountVes: number; notes?: string }) =>
      apiFetch<StoreVault>("/api/vault/deposits", { body, method: "POST" }),
    onSuccess: () => invalidate(),
  });
}

export function useVaultWithdrawal() {
  const invalidate = useInvalidateVaultQueries();

  return useMutation({
    mutationFn: (body: { amountRef: number; amountVes: number; notes?: string }) =>
      apiFetch<StoreVault>("/api/vault/withdrawals", { body, method: "POST" }),
    onSuccess: () => invalidate(),
  });
}

export function useTransferFromCash() {
  const invalidate = useInvalidateVaultQueries();

  return useMutation({
    mutationFn: (body: { notes?: string; sessionIds: string[] }) =>
      apiFetch<StoreVault>("/api/vault/transfers-from-cash", { body, method: "POST" }),
    onSuccess: () => invalidate(),
  });
}
