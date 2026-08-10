import { ApiError } from "@/lib/api/apiError";

import type { UserRole } from "./permissions";

export const PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE =
  "No tienes permiso para acceder a pagos de compras.";

/** El vendedor solo puede ver/operar pagos vinculados a ventas. */
export function canViewPurchasePayments(role: UserRole) {
  return role !== "vendedor";
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
