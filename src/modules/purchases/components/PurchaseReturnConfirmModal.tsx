"use client";

import {
  PurchaseImpactConfirmModal,
  type PurchaseImpactConfirmModalProps,
} from "./PurchaseImpactSummary";

export type PurchaseReturnConfirmModalProps = PurchaseImpactConfirmModalProps;

/**
 * Confirmación de «Devolver compra» (CNF-05) con lo que `return_purchase` hará
 * de verdad: la mercancía recibida sale del inventario como devolución al
 * proveedor; no mueve dinero ni revierte costos. Con un pago activo o sin stock
 * suficiente la RPC rechaza, así que el modal no ofrece devolver: muestra el
 * motivo y qué lo impide.
 */
export function PurchaseReturnConfirmModal(props: PurchaseReturnConfirmModalProps) {
  return (
    <PurchaseImpactConfirmModal
      {...props}
      action="return"
      blockedTitle="No se puede devolver la compra"
      confirmLabel="Devolver compra"
      description="La compra queda devuelta y su mercancía sale del inventario. Devolver no mueve dinero."
      title="Devolver compra"
    />
  );
}
