"use client";

import {
  PurchaseImpactConfirmModal,
  type PurchaseImpactConfirmModalProps,
} from "./PurchaseImpactSummary";

export type PurchaseCancelConfirmModalProps = PurchaseImpactConfirmModalProps;

/**
 * Confirmación de «Cancelar compra» (CNF-05) con lo que `cancel_purchase` hará
 * de verdad: si estaba recibida saca su mercancía del inventario; no mueve
 * dinero ni revierte costos. Con un pago activo o sin stock suficiente la RPC
 * rechaza, así que el modal no ofrece cancelar: muestra el motivo y qué lo impide.
 */
export function PurchaseCancelConfirmModal(props: PurchaseCancelConfirmModalProps) {
  return (
    <PurchaseImpactConfirmModal
      {...props}
      action="cancel"
      blockedTitle="No se puede cancelar la compra"
      confirmLabel="Cancelar compra"
      description="La compra queda cancelada. Si ya se había recibido, su mercancía sale del inventario. Cancelar no mueve dinero."
      title="Cancelar compra"
    />
  );
}
