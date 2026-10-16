/**
 * Autenticación de las rutas del escaneo que escriben con el cliente service
 * role (POST, discard y upload-url).
 *
 * Con `ALLOW_DEMO_AUTH=true` y sin sesión, `requirePermission` toma la tienda
 * de la cabecera `x-demo-store-id`. Con datos en Supabase eso dejaba a anon
 * descartar escaneos y firmar subidas de cualquier tienda (caos-4 M2): aquí,
 * en modo supabase, se exige una sesión real de Supabase (cookie o Bearer) cuyo
 * usuario sea el del contexto. En modo mock la demo sigue valiendo.
 */
import { ApiError, unauthenticatedError } from "@/lib/api/apiError";
import type { ApiDataSource } from "@/lib/api/dataSource";
import { isDemoAuthEnabled, requireStorePermission } from "@/lib/api/requirePermission";
import { getAuthProfileFromSession } from "@/lib/supabase/auth/profile.server";
import type { Permission } from "@/shared/auth/permissions";

import type { InvoiceScanContext } from "./scans.types";

export const INVOICE_SCAN_REAL_SESSION_MESSAGE =
  "Para escanear facturas con datos reales debes iniciar sesión con tu usuario; la sesión de demostración no sirve.";

export async function requireInvoiceScanSession(
  request: Request,
  permission: Permission,
  dataSource: ApiDataSource,
): Promise<InvoiceScanContext> {
  const auth = await requireStorePermission(request, permission);

  if (!auth.userId) {
    throw unauthenticatedError();
  }

  // Sin demo activa, requirePermission solo acepta la sesión real: no hace
  // falta volver a consultarla.
  if (dataSource === "supabase" && isDemoAuthEnabled()) {
    const session = await getAuthProfileFromSession();

    if (!session || session.id !== auth.userId) {
      throw new ApiError(401, "UNAUTHORIZED", INVOICE_SCAN_REAL_SESSION_MESSAGE);
    }
  }

  return { storeId: auth.storeId, userId: auth.userId };
}
