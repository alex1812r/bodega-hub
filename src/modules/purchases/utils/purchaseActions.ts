import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { roundMoney } from "@/shared/utils/currency";

/** Lo que hace falta saber de la sesión: `usePermission()` lo trae tal cual. */
export type PurchaseActionsAccess = {
  can: (permission: Permission) => boolean;
  /** `undefined` mientras el perfil no cargó: aún no se ofrece pagar. */
  role?: UserRole;
};

/** Sin importes (quien solo conoce el estado) no hay saldo que pagar. */
export type PurchaseActionsSubject = {
  paidVes?: number;
  status: string;
  totalVes?: number;
};

export type PurchaseActions = {
  /**
   * Cancelar y Devolver se OFRECEN (el rol puede; el servidor responde 403 al resto).
   * Con `isOpen: false` se muestran deshabilitadas.
   */
  canCancelOrReturn: boolean;
  /** Duplicar vale en cualquier estado: crea otra compra, no toca esta. */
  canDuplicate: boolean;
  /**
   * Registrar un pago: reglas de `register_payment` y de `POST /api/payments`. Queda
   * saldo en bolívares (total − pagado), la compra está vigente, y el rol gestiona pagos
   * y ve los de compras (admin y contador; almacén ve la compra, no sus pagos).
   */
  canPay: boolean;
  /** Recibir la mercancía: solo un pedido. */
  canReceive: boolean;
  /** Vigente (pedida o recibida): una compra cancelada o devuelta ya no se modifica. */
  isOpen: boolean;
};

/**
 * Qué acciones de una compra se ofrecen a esta sesión, por permiso y por estado. Una
 * sola regla para el menú de fila de la lista y para el detalle (COM-F10): lo que uno
 * oculta no puede ofrecerlo el otro.
 */
export function getPurchaseActions(
  purchase: PurchaseActionsSubject,
  { can, role }: PurchaseActionsAccess,
): PurchaseActions {
  const isOpen = purchase.status !== "cancelado" && purchase.status !== "devuelto";
  const canManage = can("purchases.create");
  const pendingVes = roundMoney((purchase.totalVes ?? 0) - (purchase.paidVes ?? 0));

  return {
    canCancelOrReturn: canManage,
    canDuplicate: canManage,
    canPay:
      pendingVes > 0 &&
      isOpen &&
      can("payments.manage") &&
      role !== undefined &&
      canViewPurchasePayments(role),
    canReceive: purchase.status === "pedido" && canManage,
    isOpen,
  };
}
