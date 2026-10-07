import type { SaleDetail } from "@/modules/sales/hooks/useSales";
import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

/**
 * Venta registrada con esa clave de idempotencia (`GET /api/sales/by-request/…`).
 *
 * `null` = el servidor respondio que NO hay venta con esa clave (404): se puede
 * reintentar el cobro. Cualquier otro fallo (red, 401, 500…) se relanza: no se
 * sabe si la venta existe, asi que quien llama no debe tratarlo como "no existe".
 */
export async function getSaleByClientRequestId(clientRequestId: string): Promise<SaleDetail | null> {
  try {
    return await apiFetch<SaleDetail>(
      `/api/sales/by-request/${encodeURIComponent(clientRequestId)}`,
    );
  } catch (error) {
    if (error instanceof ClientApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
