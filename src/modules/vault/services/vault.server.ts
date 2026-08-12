import { ApiError } from "@/lib/api/apiError";
import { getSupabaseErrorMessage, throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { StoreVault, VaultMovement } from "../types";
import type { deposit as mockDeposit, transferFromCash as mockTransfer, withdrawal as mockWithdrawal } from "./vault.mock-server";

type AmountInput = Parameters<typeof mockDeposit>[0];
type TransferInput = Parameters<typeof mockTransfer>[0];

function mapVault(row: Record<string, unknown>): StoreVault {
  return { balanceRef: Number(row.balance_ref), balanceVes: Number(row.balance_ves), createdAt: row.created_at as string, id: row.id as string, storeId: row.store_id as string, updatedAt: row.updated_at as string };
}
function mapMovement(row: Record<string, unknown>): VaultMovement {
  return { amountRef: Number(row.amount_ref), amountVes: Number(row.amount_ves), createdAt: row.created_at as string, fromSessionId: row.from_session_id as string | null, id: row.id as string, notes: row.notes as string | null, paymentId: row.payment_id as string | null, type: row.type as VaultMovement["type"], vaultId: row.vault_id as string };
}
function rpcError(error: unknown) {
  if (!error) return;
  const message = getSupabaseErrorMessage(error);
  if (message.toLowerCase().includes("saldo insuficiente en el baul")) throw new ApiError(400, "INSUFFICIENT_VAULT_BALANCE", message);
  throw new ApiError(400, "BAD_REQUEST", message);
}

export async function getVault(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("store_vaults").select("*").eq("store_id", storeId).maybeSingle();
  throwIfSupabaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Baúl no encontrado.");
  return mapVault(data as Record<string, unknown>);
}
export async function listVaultMovements(storeId: string) {
  const vault = await getVault(storeId);
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("vault_movements").select("*").eq("vault_id", vault.id).order("created_at", { ascending: false });
  throwIfSupabaseError(error); return (data ?? []).map((row) => mapMovement(row as Record<string, unknown>));
}
export async function deposit(input: AmountInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("register_vault_deposit", { p_amount_ref: input.amountRef, p_amount_ves: input.amountVes, p_notes: input.notes ?? null });
  rpcError(error); if (!data) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el depósito.");
  return mapVault(data as Record<string, unknown>);
}
export async function withdrawal(input: Parameters<typeof mockWithdrawal>[0], _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("register_vault_withdrawal", { p_amount_ref: input.amountRef, p_amount_ves: input.amountVes, p_notes: input.notes ?? null });
  rpcError(error); if (!data) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el retiro.");
  return mapVault(data as Record<string, unknown>);
}
export async function transferFromCash(input: TransferInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("transfer_cash_to_vault", { p_amount_ref: input.amountRef, p_amount_ves: input.amountVes, p_notes: input.notes ?? null, p_session_id: input.sessionId });
  rpcError(error); if (!data) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo transferir el efectivo.");
  return mapVault(data as Record<string, unknown>);
}
