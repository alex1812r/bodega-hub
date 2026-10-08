"use client";

import { useReducer } from "react";

import type {
  PurchaseCostCurrency,
  PurchaseDraftItem,
  PurchaseLineDisassembleState,
  PurchaseLineFocusRequest,
  PurchaseLineLockState,
  PurchaseLineReviewState,
  PurchaseTaxState,
} from "../types";
import { switchCostCurrency, syncLineCostFields } from "../utils/normalizePurchaseLine";
import {
  EMPTY_PURCHASE_LOCK_STATE,
  isPurchaseLineLocked,
  lockPurchaseLines,
  unlockPurchaseLines,
} from "../utils/purchaseLineLocks";
import {
  clearPurchaseReviewTaxChoices,
  dropPurchaseLineReview,
  EMPTY_PURCHASE_REVIEW_STATE,
  markPurchaseLinesReviewed,
  settlePurchaseLines,
  switchPurchaseReviewCostCurrency,
} from "../utils/purchaseLineReview";
import {
  chooseLineTax,
  dropLineTax,
  EMPTY_PURCHASE_TAX_STATE,
  setPurchaseExempt,
} from "../utils/purchaseLineTax";

/**
 * Estado de las líneas de la compra en curso. `items` es el borrador de core (lo
 * único que acaba en el payload); el resto es estado de la web que lo acompaña y
 * NO viaja al backend. `items`, `locks`, `review` y `taxState` son serializables:
 * el borrador guardado (COM-09 / CNF-16) puede persistirlos tal cual; `focus` es
 * efímero y no debe guardarse.
 */
export type PurchaseLinesState = {
  /**
   * Líneas marcadas «Desarmar al recibir» (COM-14). Opcional: ausente = ninguna
   * (los borradores guardados antes de COM-14 no lo traen).
   */
  disassemble?: PurchaseLineDisassembleState;
  /** Última petición de foco en la cantidad de una línea (la recién agregada). */
  focus: PurchaseLineFocusRequest | null;
  /** Líneas en el orden de la tabla: la más reciente primero. */
  items: PurchaseDraftItem[];
  /** Líneas bloqueadas (COM-12). */
  locks: PurchaseLineLockState;
  /** Historial de edición por línea (COM-13). */
  review: PurchaseLineReviewState;
  /** Alícuotas elegidas a mano y "Compra exenta" (COM-11). */
  taxState: PurchaseTaxState;
};

/** Lo que se persiste y se repone de las líneas: todo menos el foco. */
export type PurchaseLinesSnapshot = Omit<PurchaseLinesState, "focus">;

export type PurchaseLinesAction =
  | { type: "allLinesLocked" }
  | { type: "allLinesUnlocked" }
  | { currency: PurchaseCostCurrency; rateVes: number; type: "costCurrencyChanged" }
  | { exempt: boolean; type: "exemptChanged" }
  /** Chip «Desarmar al recibir» de una línea; una línea bloqueada lo ignora. */
  | { disassemble: boolean; itemId: string; type: "lineDisassembleChanged" }
  | { itemId: string; locked: boolean; type: "lineLockChanged" }
  /**
   * Las líneas se reponen de golpe (COM-09): al restaurar el borrador guardado o
   * al duplicar una compra. Sustituye todo lo que hubiera; nadie pide el foco.
   */
  | { state: PurchaseLinesSnapshot; type: "linesRestored" }
  /** El foco salió de la fila: la línea deja de ser recién nacida. */
  | { itemId: string; type: "lineSettled" }
  /** Una línea bloqueada no se quita: la acción se ignora. */
  | { itemId: string; type: "lineRemoved" }
  /** Una línea bloqueada no cambia de alícuota: la acción se ignora. */
  | { code: string; itemId: string; type: "lineTaxChosen" }
  /** Una línea bloqueada no se edita: la acción se ignora. */
  | { input: Partial<PurchaseDraftItem>; itemId: string; rateVes: number; type: "lineUpdated" }
  /**
   * `line` es la línea que nacería para ese producto; si el producto ya está en
   * la compra no se usa: se suma 1 a la existente y sube al principio. En ambos
   * casos esa línea queda desbloqueada y pide el foco en su cantidad; con
   * `lockOthers` (preferencia "Bloquear al agregar") las demás se bloquean.
   */
  | { line: PurchaseDraftItem; lockOthers: boolean; rateVes: number; type: "productAdded" }
  /** Cambió el proveedor: la compra empieza de cero y conserva "Compra exenta". */
  | { type: "supplierChanged" };

export const EMPTY_PURCHASE_LINES_STATE: PurchaseLinesState = {
  focus: null,
  items: [],
  locks: EMPTY_PURCHASE_LOCK_STATE,
  review: EMPTY_PURCHASE_REVIEW_STATE,
  taxState: EMPTY_PURCHASE_TAX_STATE,
};

/** Las marcas «Desarmar al recibir» con esa línea marcada o desmarcada. */
function setLineDisassemble(
  state: PurchaseLineDisassembleState | undefined,
  itemId: string,
  disassemble: boolean,
): PurchaseLineDisassembleState {
  const next = Object.fromEntries(
    Object.entries(state ?? {}).filter(([id]) => id !== itemId),
  ) as PurchaseLineDisassembleState;

  if (disassemble) {
    next[itemId] = true;
  }

  return next;
}

function bumpLine(item: PurchaseDraftItem, rateVes: number) {
  return syncLineCostFields(
    item.entryMode === "pack"
      ? { ...item, packCount: item.packCount + 1 }
      : { ...item, quantity: item.quantity + 1 },
    rateVes,
  );
}

/**
 * Bloquea esas líneas: quedan asentadas (lo capturado hasta aquí ya no es
 * "primera captura") y revisadas (su punto "Línea editada" se apaga).
 */
function lockLines(state: PurchaseLinesState, items: PurchaseDraftItem[]): PurchaseLinesState {
  const pending = items.filter((item) => !isPurchaseLineLocked(state.locks, item.id));

  if (pending.length === 0) {
    return state;
  }

  return {
    ...state,
    locks: lockPurchaseLines(
      state.locks,
      pending.map((item) => item.id),
    ),
    review: markPurchaseLinesReviewed(
      settlePurchaseLines(state.review, pending, state.taxState),
      pending,
      state.taxState,
    ),
  };
}

export function purchaseLinesReducer(
  state: PurchaseLinesState,
  action: PurchaseLinesAction,
): PurchaseLinesState {
  switch (action.type) {
    case "allLinesLocked":
      return lockLines(state, state.items);

    case "allLinesUnlocked":
      return { ...state, locks: EMPTY_PURCHASE_LOCK_STATE };

    case "costCurrencyChanged":
      return {
        ...state,
        items: state.items.map((item) =>
          switchCostCurrency(item, action.currency, action.rateVes),
        ),
        review: switchPurchaseReviewCostCurrency(state.review, action.currency, action.rateVes),
      };

    case "exemptChanged":
      return {
        ...state,
        review: clearPurchaseReviewTaxChoices(state.review),
        taxState: setPurchaseExempt(action.exempt),
      };

    case "lineDisassembleChanged":
      if (isPurchaseLineLocked(state.locks, action.itemId)) {
        return state;
      }

      return {
        ...state,
        disassemble: setLineDisassemble(state.disassemble, action.itemId, action.disassemble),
      };

    case "lineLockChanged":
      return action.locked
        ? lockLines(
            state,
            state.items.filter((item) => item.id === action.itemId),
          )
        : { ...state, locks: unlockPurchaseLines(state.locks, [action.itemId]) };

    case "linesRestored":
      return { ...action.state, focus: state.focus };

    case "lineSettled":
      return {
        ...state,
        review: settlePurchaseLines(
          state.review,
          state.items.filter((item) => item.id === action.itemId),
          state.taxState,
        ),
      };

    case "lineRemoved":
      if (isPurchaseLineLocked(state.locks, action.itemId)) {
        return state;
      }

      return {
        ...state,
        ...(state.disassemble
          ? { disassemble: setLineDisassemble(state.disassemble, action.itemId, false) }
          : {}),
        items: state.items.filter((item) => item.id !== action.itemId),
        review: dropPurchaseLineReview(state.review, action.itemId),
        taxState: dropLineTax(state.taxState, action.itemId),
      };

    case "lineTaxChosen":
      if (isPurchaseLineLocked(state.locks, action.itemId)) {
        return state;
      }

      return { ...state, taxState: chooseLineTax(state.taxState, action.itemId, action.code) };

    case "lineUpdated":
      if (isPurchaseLineLocked(state.locks, action.itemId)) {
        return state;
      }

      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.itemId
            ? syncLineCostFields({ ...item, ...action.input }, action.rateVes)
            : item,
        ),
      };

    case "productAdded": {
      const existing = state.items.find((item) => item.productId === action.line.productId);
      const target = existing ? bumpLine(existing, action.rateVes) : action.line;
      const others = state.items.filter((item) => item.id !== target.id);
      // Agregar asienta todo lo que había: desde aquí cualquier cambio es una edición,
      // también el +1 de volver a agregar el mismo producto.
      const settled = {
        ...state,
        review: settlePurchaseLines(state.review, state.items, state.taxState),
      };
      const next = action.lockOthers ? lockLines(settled, others) : settled;

      return {
        ...next,
        focus: { itemId: target.id, token: (state.focus?.token ?? 0) + 1 },
        items: [target, ...others],
        locks: unlockPurchaseLines(next.locks, [target.id]),
      };
    }

    case "supplierChanged":
      return {
        ...EMPTY_PURCHASE_LINES_STATE,
        taxState: setPurchaseExempt(state.taxState.exempt),
      };
  }
}

/** Reductor de las líneas de la compra; la página despacha `PurchaseLinesAction`. */
export function usePurchaseLines() {
  return useReducer(purchaseLinesReducer, EMPTY_PURCHASE_LINES_STATE);
}
