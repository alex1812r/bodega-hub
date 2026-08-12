"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/shared/api/apiFetch";
import type { StoreVault, VaultMovement } from "../types";
export const vaultKeys = { all: ["vault"] as const, movements: ["vault", "movements"] as const };
export function useVault() { return useQuery({ queryKey: vaultKeys.all, queryFn: () => apiFetch<StoreVault>("/api/vault") }); }
export function useVaultMovements() { return useQuery({ queryKey: vaultKeys.movements, queryFn: () => apiFetch<VaultMovement[]>("/api/vault/movements") }); }
function useVaultMutation(path: string) { const queryClient = useQueryClient(); return useMutation({ mutationFn: (body: object) => apiFetch<StoreVault>(path, { body, method: "POST" }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: vaultKeys.all }) }); }
export function useVaultDeposit() { return useVaultMutation("/api/vault/deposits"); }
export function useVaultWithdrawal() { return useVaultMutation("/api/vault/withdrawals"); }
export function useTransferFromCash() { return useVaultMutation("/api/vault/transfers-from-cash"); }
