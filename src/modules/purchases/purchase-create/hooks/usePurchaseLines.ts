"use client";

import { useReducer } from "react";

import type {
  PurchaseCostCurrency,
  PurchaseDraftItem,
  PurchaseLineReviewState,
  PurchaseTaxState,
} from "../types";
import { switchCostCurrency, syncLineCostFields } from "../utils/normalizePurchaseLine";
import {
  clearPurchaseReviewTaxChoices,
  dropPurchaseLineReview,
  EMPTY_PURCHASE_REVIEW_STATE,
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
 * NO viaja al backend. Es serializable: el borrador guardado (COM-09 / CNF-16)
 * puede persistirlo tal cual.
 */
export type PurchaseLinesState = {
  /** Líneas en el orden de la tabla: la más reciente primero. */
  items: PurchaseDraftItem[];
  /** Historial de edición por línea (COM-13). */
  review: PurchaseLineReviewState;
  /** Alícuotas elegidas a mano y "Compra exenta" (COM-11). */
  taxState: PurchaseTaxState;
};

export type PurchaseLinesAction =
  | { currency: PurchaseCostCurrency; rateVes: number; type: "costCurrencyChanged" }
  | { exempt: boolean; type: "exemptChanged" }
  /** El foco salió de la fila: la línea deja de ser recién nacida. */
  | { itemId: string; type: "lineSettled" }
  | { itemId: string; type: "lineRemoved" }
  | { code: string; itemId: string; type: "lineTaxChosen" }
  | { input: Partial<PurchaseDraftItem>; itemId: string; rateVes: number; type: "lineUpdated" }
  /**
   * `line` es la línea que nacería para ese producto; si el producto ya está en
   * la compra no se usa: se suma 1 a la existente y sube al principio.
   */
  | { line: PurchaseDraftItem; rateVes: number; type: "productAdded" }
  /** Cambió el proveedor: la compra empieza de cero y conserva "Compra exenta". */
  | { type: "supplierChanged" };

export const EMPTY_PURCHASE_LINES_STATE: PurchaseLinesState = {
  items: [],
  review: EMPTY_PURCHASE_REVIEW_STATE,
  taxState: EMPTY_PURCHASE_TAX_STATE,
};

function bumpLine(item: PurchaseDraftItem, rateVes: number) {
  return syncLineCostFields(
    item.entryMode === "pack"
      ? { ...item, packCount: item.packCount + 1 }
      : { ...item, quantity: item.quantity + 1 },
    rateVes,
  );
}

export function purchaseLinesReducer(
  state: PurchaseLinesState,
  action: PurchaseLinesAction,
): PurchaseLinesState {
  switch (action.type) {
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
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.itemId),
        review: dropPurchaseLineReview(state.review, action.itemId),
        taxState: dropLineTax(state.taxState, action.itemId),
      };

    case "lineTaxChosen":
      return { ...state, taxState: chooseLineTax(state.taxState, action.itemId, action.code) };

    case "lineUpdated":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.itemId
            ? syncLineCostFields({ ...item, ...action.input }, action.rateVes)
            : item,
        ),
      };

    case "productAdded": {
      // Agregar asienta todo lo que había: desde aquí cualquier cambio es una edición,
      // también el +1 de volver a agregar el mismo producto.
      const review = settlePurchaseLines(state.review, state.items, state.taxState);
      const existing = state.items.find((item) => item.productId === action.line.productId);

      if (!existing) {
        return { ...state, items: [action.line, ...state.items], review };
      }

      return {
        ...state,
        items: [
          bumpLine(existing, action.rateVes),
          ...state.items.filter((item) => item.id !== existing.id),
        ],
        review,
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
