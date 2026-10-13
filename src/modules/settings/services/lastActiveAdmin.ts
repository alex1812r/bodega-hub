import { ApiError } from "@/lib/api/apiError";

export const LAST_ACTIVE_ADMIN_MESSAGE =
  "La tienda debe conservar al menos un administrador activo.";

type AdminStanding = { isActive: boolean; role: string };

/** Sostiene la administración de la tienda: rol `admin` y activo. */
export function isActiveAdmin(user: AdminStanding) {
  return user.role === "admin" && user.isActive;
}

/**
 * El cambio deja de contar a `user` como administrador activo: le quita el rol
 * `admin` o lo desactiva, y hoy lo es.
 */
export function removesActiveAdmin(
  user: AdminStanding,
  change: { isActive?: boolean; role?: string },
) {
  return (
    isActiveAdmin(user) &&
    !isActiveAdmin({
      isActive: change.isActive ?? user.isActive,
      role: change.role ?? user.role,
    })
  );
}

/**
 * Regla de `PATCH /api/users/{id}` (CAOS-03): la tienda no se queda sin ningún
 * administrador activo. Solo cuentan los perfiles de ESA tienda con rol `admin`:
 * el superadmin de plataforma no tiene tienda ni puede operar el ERP de una.
 */
export function assertStoreKeepsActiveAdmin(otherActiveAdmins: number) {
  if (otherActiveAdmins < 1) {
    throw new ApiError(409, "CONFLICT", LAST_ACTIVE_ADMIN_MESSAGE);
  }
}
