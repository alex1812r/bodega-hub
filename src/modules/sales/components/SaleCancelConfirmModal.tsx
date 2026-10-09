"use client";

import { SaleImpactConfirmModal, type SaleImpactConfirmModalProps } from "./SaleImpactSummary";

export type SaleCancelConfirmModalProps = SaleImpactConfirmModalProps & {
  /**
   * Abre la devolución de esta misma venta. Se ofrece cuando anular no es
   * posible por tener pagos activos: devolver sí los revierte.
   */
  onUseReturn?: () => void;
};

/**
 * Confirmación de «Anular venta» (CNF-02) con lo que `cancel_sale` hará de
 * verdad: repone el stock y NO toca dinero. Con un pago activo la RPC rechaza la
 * anulación, así que el modal no ofrece anular: muestra el motivo, los pagos que
 * hay que anular antes y cómo llegar a ellos (o devolver la venta).
 */
export function SaleCancelConfirmModal({ onUseReturn, ...props }: SaleCancelConfirmModalProps) {
  return (
    <SaleImpactConfirmModal
      {...props}
      action="cancel"
      blockedAlternative={
        onUseReturn
          ? {
              hint: "Anular no revierte pagos. Puedes anular antes cada pago o devolver la venta: la devolución sí los revierte.",
              label: "Devolver la venta",
              onSelect: onUseReturn,
            }
          : undefined
      }
      blockedTitle="No se puede anular la venta"
      confirmLabel="Anular venta"
      description="La venta queda anulada y sus productos vuelven al stock. Anular no mueve dinero."
      title="Anular venta"
      typedWord="ANULAR"
    />
  );
}
