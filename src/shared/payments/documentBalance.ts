/**
 * Saldo de una venta o de una compra: la ÚNICA noción de "saldado" en lectura (GQ-07).
 *
 * El criterio es el del servidor, y es en BOLÍVARES:
 *  - `register_payment` (supabase/patches/20261008a) mide el saldo como
 *    `round(total_ves - paid_ves, 2)`; deja la venta en `pagada` exactamente cuando
 *    `paid_ves >= total_ves` y, en una compra (que no guarda estado de pago), acepta
 *    pagos mientras ese saldo sea positivo.
 *  - `report_open_documents_aging` (20261013a) lista como abierto lo mismo: venta
 *    `pendiente_pago` o compra `pedido` / `recibido` con `round(total_ves - paid_ves, 2) > 0`.
 *
 * `paid_ref` contra `total_ref` NO decide nada: una compra puede tener todo el REF
 * pagado y deber céntimos de Bs (total en Bs ≠ total_ref × tasa), o estar saldada en
 * Bs con REF de menos (pagada a una tasa del día más alta). Detalle, listas, Saldos,
 * `open-documents`, reportes y formulario de pago leen el saldo de aquí.
 */

export type BalanceDocumentType = "purchase" | "sale";

export type DocumentPaymentStatus = "pagada" | "parcial" | "pendiente";

export type DocumentBalanceInput = {
  /** Solo compras: las ventas no guardan lo cobrado en REF. */
  paidRef?: number;
  paidVes?: number;
  /** Tasa del documento; da el saldo en REF de una venta. */
  refRateVes?: number;
  status: string;
  totalRef?: number;
  totalVes?: number;
  type: BalanceDocumentType;
};

export type DocumentBalance = {
  /** Deuda vigente: el estado admite pagos y queda saldo. Es lo que listan los pendientes. */
  open: boolean;
  paymentStatus: DocumentPaymentStatus;
  /** 0 si está saldado. Compras: `total_ref - paid_ref`. Ventas: el saldo en Bs a su tasa. */
  pendingRef: number;
  /** `round(total_ves - paid_ves, 2)`, nunca negativo. */
  pendingVes: number;
  /** Sin saldo en Bs: el servidor ya no espera ningún pago. */
  settled: boolean;
};

/** Estados en los que el documento puede deberse (y `register_payment` acepta el pago). */
const PAYABLE_STATUSES: Record<BalanceDocumentType, readonly string[]> = {
  purchase: ["pedido", "recibido"],
  sale: ["pendiente_pago", "pagada"],
};

function toCents(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function isPayableDocumentStatus(type: BalanceDocumentType, status: string) {
  return PAYABLE_STATUSES[type].includes(status);
}

export function documentBalance(document: DocumentBalanceInput): DocumentBalance {
  const pendingVesCents = Math.max(toCents(document.totalVes) - toCents(document.paidVes), 0);
  const settled = pendingVesCents <= 0;
  const pendingVes = pendingVesCents / 100;
  let pendingRef = 0;

  if (!settled) {
    const rate = document.refRateVes;

    pendingRef =
      document.type === "sale" && rate !== undefined && rate > 0
        ? Math.round((pendingVes / rate) * 100) / 100
        : Math.max(toCents(document.totalRef) - toCents(document.paidRef), 0) / 100;
  }

  return {
    open: !settled && isPayableDocumentStatus(document.type, document.status),
    paymentStatus: settled ? "pagada" : toCents(document.paidVes) > 0 ? "parcial" : "pendiente",
    pendingRef,
    pendingVes,
    settled,
  };
}
