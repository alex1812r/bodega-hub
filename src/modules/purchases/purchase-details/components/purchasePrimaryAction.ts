import type { PurchaseStatus } from "@/shared/mocks/erp-data";

export type PurchasePrimaryActionKind = "receive" | "pay" | "pdf";

type PurchasePrimaryActionInput = {
  /** Puede registrar un pago: `getPurchaseActions().canPay` (saldo, vigencia y permiso). */
  canPay: boolean;
  /** Puede recibir la mercancía: `getPurchaseActions().canReceive` (pedido y permiso). */
  canReceive: boolean;
};

/**
 * La acción que toca según el estado real de la compra y lo que la sesión puede
 * hacer: recibir un pedido, si no pagar el saldo, si no ver el PDF. Una compra
 * cancelada o devuelta nunca llega con `canReceive` ni `canPay`: cae al PDF.
 */
export function getPurchasePrimaryAction({
  canPay,
  canReceive,
}: PurchasePrimaryActionInput): PurchasePrimaryActionKind {
  if (canReceive) {
    return "receive";
  }

  return canPay ? "pay" : "pdf";
}

/** Aviso de la cabecera para una compra que ya no admite recepción ni pagos. */
export function getPurchaseClosedNotice(status: PurchaseStatus): string | null {
  switch (status) {
    case "cancelado":
      return "Compra cancelada: ya no admite recepción ni pagos.";
    case "devuelto":
      return "Compra devuelta: ya no admite recepción ni pagos.";
    default:
      return null;
  }
}
