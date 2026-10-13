import { hasEffectivePermission, type PermissionProfile } from "@/shared/auth/permissions";

export const CASH_REGISTER_ASSIGNEE_MESSAGE =
  "Solo se puede asignar la caja a un usuario activo de la tienda que pueda operar caja.";

export type CashRegisterAssigneeProfile = PermissionProfile & { isActive: boolean };

/**
 * A quién se le puede asignar una caja: usuario activo con `cash.operate`
 * efectivo (rol + excepciones). Son los vendedores, los administradores con «El
 * administrador puede vender» y quien tenga el permiso concedido. La misma regla
 * filtra el selector de Cajas y valida `PATCH /api/cash/registers/{id}`.
 */
export function canBeAssignedCashRegister(profile: CashRegisterAssigneeProfile) {
  return profile.isActive && hasEffectivePermission(profile, "cash.operate");
}
