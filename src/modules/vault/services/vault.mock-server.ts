import { ApiError } from "@/lib/api/apiError";
import { markSessionsTransferredToVault } from "@/modules/cash/services/cash.session.mock-server";

import type { StoreVault, VaultMovement } from "../types";

const vaults: StoreVault[] = [];
const movements: VaultMovement[] = [];
type AmountInput = { amountRef: number; amountVes: number; notes?: string };

function getOrCreate(storeId: string) {
  let vault = vaults.find((item) => item.storeId === storeId);
  if (!vault) {
    const now = new Date().toISOString();
    vault = {
      balanceEfectivoVes: 0,
      balanceRef: 0,
      balanceVes: 0,
      createdAt: now,
      id: `vault-${storeId}`,
      storeId,
      updatedAt: now,
    };
    vaults.push(vault);
  }
  return vault;
}

function validate(input: AmountInput) {
  if (input.amountRef < 0 || input.amountVes < 0 || (!input.amountRef && !input.amountVes)) {
    throw new ApiError(400, "BAD_REQUEST", "Debes indicar al menos un monto mayor a cero.");
  }
}

function record(
  vault: StoreVault,
  input: AmountInput,
  type: VaultMovement["type"],
  bucket: VaultMovement["bucket"],
  fromSessionId?: string,
) {
  movements.unshift({
    amountRef: input.amountRef,
    amountVes: input.amountVes,
    bucket,
    createdAt: new Date().toISOString(),
    fromSessionId,
    id: `vault-movement-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    notes: input.notes,
    type,
    vaultId: vault.id,
  });
}

export function getVault(storeId: string) {
  return getOrCreate(storeId);
}

export function listVaultMovements(storeId: string) {
  const vault = getOrCreate(storeId);
  return movements.filter((item) => item.vaultId === vault.id);
}

export function deposit(input: AmountInput, storeId: string) {
  validate(input);
  const vault = getOrCreate(storeId);
  vault.balanceEfectivoVes += input.amountVes;
  vault.balanceRef += input.amountRef;
  vault.updatedAt = new Date().toISOString();
  record(vault, input, "deposit", "efectivo");
  return vault;
}

export function withdrawal(input: AmountInput, storeId: string) {
  validate(input);
  const vault = getOrCreate(storeId);
  if (input.amountRef > vault.balanceRef || input.amountVes > vault.balanceEfectivoVes) {
    throw new ApiError(400, "INSUFFICIENT_VAULT_BALANCE", "Saldo insuficiente en el baúl (efectivo).", {
      balanceEfectivoVes: vault.balanceEfectivoVes,
      balanceRef: vault.balanceRef,
    });
  }
  vault.balanceEfectivoVes -= input.amountVes;
  vault.balanceRef -= input.amountRef;
  vault.updatedAt = new Date().toISOString();
  record(vault, input, "withdrawal", "efectivo");
  return vault;
}

export function transferFromCash(
  input: { notes?: string; sessionIds: string[] },
  storeId: string,
) {
  if (!input.sessionIds.length) {
    throw new ApiError(400, "BAD_REQUEST", "Selecciona al menos un cierre de caja para transferir.");
  }
  const closures = markSessionsTransferredToVault(input.sessionIds, storeId);
  const vault = getOrCreate(storeId);
  for (const session of closures) {
    const amount = {
      amountRef: session.closingRef ?? 0,
      amountVes: session.closingVes ?? 0,
      notes: input.notes,
    };
    vault.balanceEfectivoVes += amount.amountVes;
    vault.balanceRef += amount.amountRef;
    record(vault, amount, "transfer_in", "efectivo", session.id);
  }
  vault.updatedAt = new Date().toISOString();
  return vault;
}
