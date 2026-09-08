import { ApiError } from "@/lib/api/apiError";
import { markSessionsTransferredToVault } from "@/modules/cash/services/cash.session.mock-server";
import { mockState } from "@/shared/mocks/mockStore";

import type { StoreVault, VaultMovement } from "../types";

// Anclado a globalThis para que los saldos sobrevivan a las recompilaciones de
// `next dev`. Ver `src/shared/mocks/mockStore.ts`.
const vaults = mockState<StoreVault[]>("vault:vaults", () => []);
const movements = mockState<VaultMovement[]>("vault:movements", () => []);
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
  const movement: VaultMovement = {
    amountRef: input.amountRef,
    amountVes: input.amountVes,
    bucket,
    createdAt: new Date().toISOString(),
    fromSessionId,
    id: `vault-movement-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    notes: input.notes,
    type,
    vaultId: vault.id,
  };

  movements.unshift(movement);

  return movement;
}

/** Solo para tests: devuelve el baúl mock a su estado inicial (vacío). */
export function __resetVaultMockState() {
  vaults.length = 0;
  movements.length = 0;
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

/**
 * Salida de nómina. La cubeta la decide el módulo de nómina (efectivo Bs, efectivo
 * USD o cuenta), igual que hace `pay_payroll_item` en Postgres, así que aquí solo
 * se descuenta y se deja el asiento en el libro del baúl. La validación de saldo
 * vive en el mock de nómina, que es quien conoce el mensaje por cubeta.
 */
export function registerPayrollOut(
  input: AmountInput & { bucket: VaultMovement["bucket"]; payrollItemId: string },
  storeId: string,
) {
  const vault = getOrCreate(storeId);

  if (input.bucket === "efectivo") {
    vault.balanceEfectivoVes -= input.amountVes;
    vault.balanceRef -= input.amountRef;
  } else {
    vault.balanceVes -= input.amountVes;
  }

  vault.updatedAt = new Date().toISOString();

  const movement = record(vault, input, "payroll_out", input.bucket);
  movement.payrollItemId = input.payrollItemId;

  return movement;
}

/**
 * Anular un pago de nómina devuelve el dinero a su cubeta y escribe el asiento
 * contrario. El movimiento original **no** se borra: un libro del que se puede
 * borrar no sirve para cuadrar (ver `docs/cuadre-baul.md` §3).
 */
export function revertPayrollOut(movementId: string, storeId: string, notes?: string) {
  const vault = getOrCreate(storeId);
  const movement = movements.find(
    (item) => item.id === movementId && item.vaultId === vault.id,
  );

  if (!movement) {
    return vault;
  }

  if (movement.bucket === "efectivo") {
    vault.balanceEfectivoVes += movement.amountVes;
    vault.balanceRef += movement.amountRef;
  } else {
    vault.balanceVes += movement.amountVes;
  }

  vault.updatedAt = new Date().toISOString();

  const reversal = record(
    vault,
    {
      amountRef: movement.amountRef,
      amountVes: movement.amountVes,
      notes: `Anulación de nómina: ${notes ?? "sin motivo"}`,
    },
    "adjustment",
    movement.bucket,
  );
  reversal.payrollItemId = movement.payrollItemId;

  return vault;
}

/** Saldo inicial de demostración: el baúl mock nace en cero y la nómina necesita fondos. */
export function seedVaultBalance(
  input: { balanceEfectivoVes: number; balanceRef: number; balanceVes: number },
  storeId: string,
) {
  const vault = getOrCreate(storeId);

  vault.balanceEfectivoVes += input.balanceEfectivoVes;
  vault.balanceRef += input.balanceRef;
  vault.balanceVes += input.balanceVes;
  vault.updatedAt = new Date().toISOString();

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
