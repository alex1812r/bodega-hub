import type { PurchaseLineLockState } from "../types";

export const EMPTY_PURCHASE_LOCK_STATE: PurchaseLineLockState = { locked: {} };

export function isPurchaseLineLocked(state: PurchaseLineLockState, itemId: string) {
  return state.locked[itemId] === true;
}

/** Bloquea esas líneas; las que ya lo estaban siguen igual. */
export function lockPurchaseLines(
  state: PurchaseLineLockState,
  itemIds: string[],
): PurchaseLineLockState {
  const pending = itemIds.filter((itemId) => !isPurchaseLineLocked(state, itemId));

  if (pending.length === 0) {
    return state;
  }

  const locked = { ...state.locked };
  for (const itemId of pending) {
    locked[itemId] = true;
  }

  return { locked };
}

/** Desbloquea esas líneas. También sirve para olvidar el bloqueo de una línea quitada. */
export function unlockPurchaseLines(
  state: PurchaseLineLockState,
  itemIds: string[],
): PurchaseLineLockState {
  if (!itemIds.some((itemId) => isPurchaseLineLocked(state, itemId))) {
    return state;
  }

  const locked = { ...state.locked };
  for (const itemId of itemIds) {
    delete locked[itemId];
  }

  return { locked };
}
