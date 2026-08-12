import { ApiError } from "@/lib/api/apiError";
import { addTransferOut } from "@/modules/cash/services/cash.session.mock-server";

import type { StoreVault, VaultMovement } from "../types";

const vaults: StoreVault[] = [];
const movements: VaultMovement[] = [];
type AmountInput = { amountRef: number; amountVes: number; notes?: string };

function getOrCreate(storeId: string) {
  let vault = vaults.find((item) => item.storeId === storeId);
  if (!vault) {
    const now = new Date().toISOString();
    vault = { balanceRef: 0, balanceVes: 0, createdAt: now, id: `vault-${storeId}`, storeId, updatedAt: now };
    vaults.push(vault);
  }
  return vault;
}

function validate(input: AmountInput) {
  if (input.amountRef < 0 || input.amountVes < 0 || (!input.amountRef && !input.amountVes)) {
    throw new ApiError(400, "BAD_REQUEST", "Debes indicar al menos un monto mayor a cero.");
  }
}

function record(vault: StoreVault, input: AmountInput, type: VaultMovement["type"], fromSessionId?: string) {
  movements.unshift({ amountRef: input.amountRef, amountVes: input.amountVes, createdAt: new Date().toISOString(), fromSessionId, id: `vault-movement-${Date.now()}`, notes: input.notes, type, vaultId: vault.id });
}

export function getVault(storeId: string) { return getOrCreate(storeId); }
export function listVaultMovements(storeId: string) {
  const vault = getOrCreate(storeId);
  return movements.filter((item) => item.vaultId === vault.id);
}
export function deposit(input: AmountInput, storeId: string) {
  validate(input); const vault = getOrCreate(storeId);
  vault.balanceRef += input.amountRef; vault.balanceVes += input.amountVes; vault.updatedAt = new Date().toISOString();
  record(vault, input, "deposit"); return vault;
}
export function withdrawal(input: AmountInput, storeId: string) {
  validate(input); const vault = getOrCreate(storeId);
  if (input.amountRef > vault.balanceRef || input.amountVes > vault.balanceVes) throw new ApiError(400, "INSUFFICIENT_VAULT_BALANCE", "Saldo insuficiente en el baúl.", { balanceRef: vault.balanceRef, balanceVes: vault.balanceVes });
  vault.balanceRef -= input.amountRef; vault.balanceVes -= input.amountVes; vault.updatedAt = new Date().toISOString();
  record(vault, input, "withdrawal"); return vault;
}
export function transferFromCash(input: AmountInput & { sessionId: string }, storeId: string) {
  validate(input); const vault = getOrCreate(storeId);
  addTransferOut(input.sessionId, input.amountVes, input.amountRef, input.notes);
  vault.balanceRef += input.amountRef; vault.balanceVes += input.amountVes; vault.updatedAt = new Date().toISOString();
  record(vault, input, "transfer_in", input.sessionId); return vault;
}
