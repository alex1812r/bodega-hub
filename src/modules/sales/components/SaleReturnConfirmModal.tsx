"use client";

import { SaleImpactConfirmModal, type SaleImpactConfirmModalProps } from "./SaleImpactSummary";

export type SaleReturnConfirmModalProps = SaleImpactConfirmModalProps;

/**
 * Confirmación de «Devolver venta» (CNF-03) con lo que `return_sale` hará de
 * verdad. La devolución es siempre TOTAL: vuelven todas las unidades que quedan
 * por reponer y se anula cada pago activo, revirtiendo sus asientos de caja y
 * baúl. No hay cantidades que elegir.
 */
export function SaleReturnConfirmModal(props: SaleReturnConfirmModalProps) {
  return (
    <SaleImpactConfirmModal
      {...props}
      action="return"
      blockedTitle="No se puede devolver la venta"
      confirmLabel="Devolver venta"
      description="Devolución total: todos los productos vuelven al stock y se anulan los pagos de la venta."
      title="Devolver venta"
      typedWord="DEVOLVER"
    />
  );
}
