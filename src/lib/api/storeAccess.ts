import { ApiError } from "@/lib/api/apiError";
import type { ApiAuthContext } from "@/lib/api/requirePermission";

export const STORE_ACCESS_FORBIDDEN_MESSAGE =
  "No tienes permisos para realizar esta operacion en este recurso.";

export const SUPERADMIN_ERP_FORBIDDEN_MESSAGE =
  "El superadmin no opera datos de tienda. Usa el panel de plataforma.";

export type StoreAuthContext = ApiAuthContext & {
  isSuperadmin: boolean;
  storeId: string;
};

/** Verifica que el recurso pertenezca a la tienda del caller. */
export function assertStoreAccess(authStoreId: string, resourceStoreId: string | null | undefined) {
  if (!resourceStoreId || resourceStoreId !== authStoreId) {
    throw new ApiError(403, "FORBIDDEN", STORE_ACCESS_FORBIDDEN_MESSAGE);
  }
}

/** Asegura contexto de tienda (no superadmin, storeId presente). */
export function requireStoreId(auth: ApiAuthContext): string {
  if (auth.isSuperadmin || auth.role === "superadmin") {
    throw new ApiError(403, "FORBIDDEN", SUPERADMIN_ERP_FORBIDDEN_MESSAGE);
  }

  if (!auth.storeId) {
    throw new ApiError(403, "FORBIDDEN", STORE_ACCESS_FORBIDDEN_MESSAGE);
  }

  return auth.storeId;
}

export function toStoreAuthContext(auth: ApiAuthContext): StoreAuthContext {
  const storeId = requireStoreId(auth);

  return {
    ...auth,
    isSuperadmin: false,
    storeId,
  };
}
