import type { PaymentListItem } from "../../hooks/usePayments";

export type PaymentDocument = {
  /** Detalle de la venta o compra, sin `returnTo`. */
  href: string;
  kind: "purchase" | "sale";
  /** Número del documento; si la lista no lo trae, "Venta" o "Compra" (nunca el id). */
  label: string;
};

type PaymentDocumentSource = Pick<PaymentListItem, "purchaseId" | "relatedDocument" | "saleId">;

/** Documento (venta o compra) al que abona el pago, para la columna "Documento". */
export function getPaymentDocument(payment: PaymentDocumentSource): PaymentDocument | null {
  if (payment.saleId) {
    return {
      href: payment.relatedDocument?.href ?? `/sales/${payment.saleId}`,
      kind: "sale",
      label: payment.relatedDocument?.label ?? "Venta",
    };
  }

  if (payment.purchaseId) {
    return {
      href: payment.relatedDocument?.href ?? `/purchases/${payment.purchaseId}`,
      kind: "purchase",
      label: payment.relatedDocument?.label ?? "Compra",
    };
  }

  return null;
}
