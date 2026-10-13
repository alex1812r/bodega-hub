import { ApiError } from "@/lib/api/apiError";

import { getRolePermissions, type UserRole } from "./permissions";

export const PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE =
  "No tienes permiso para acceder a pagos de compras.";

/**
 * Ve / opera pagos de compras el rol que tiene a la vez `payments.view` y
 * `purchases.view`: admin y contador. El vendedor solo ve pagos de ventas y
 * almacén ve la compra, pero no sus pagos. Es la misma regla que la política
 * de lectura de `payments` (parche 20261010c).
 */
export function canViewPurchasePayments(role: UserRole) {
  const granted = getRolePermissions(role);

  return granted.includes("payments.view") && granted.includes("purchases.view");
}

export function isPurchasePayment(payment: {
  direction?: string | null;
  purchaseId?: string | null;
  purchase_id?: string | null;
}) {
  return Boolean(payment.purchaseId ?? payment.purchase_id) || payment.direction === "salida";
}

export function assertCanAccessPayment(
  role: UserRole,
  payment: {
    direction?: string | null;
    purchaseId?: string | null;
    purchase_id?: string | null;
  },
) {
  if (!canViewPurchasePayments(role) && isPurchasePayment(payment)) {
    throw new ApiError(403, "FORBIDDEN", PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);
  }
}

/** Rechaza filtros que solo tienen sentido para pagos de compra. */
export function assertCanQueryPurchasePayments(role: UserRole, searchParams: URLSearchParams) {
  if (canViewPurchasePayments(role)) {
    return;
  }

  const purchaseId = searchParams.get("purchaseId");
  const direction = searchParams.get("direction");

  if (purchaseId || direction === "salida") {
    throw new ApiError(403, "FORBIDDEN", PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);
  }
}

export function assertCanCreatePurchasePayment(
  role: UserRole,
  input: { purchaseId?: string | null },
) {
  if (!canViewPurchasePayments(role) && input.purchaseId) {
    throw new ApiError(403, "FORBIDDEN", PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);
  }
}
