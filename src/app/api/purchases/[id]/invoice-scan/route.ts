import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireInvoiceScanSession } from "@/modules/invoice-scan/server/requireScanSession";
import { createInvoiceScanDeps, getPurchaseInvoiceScan } from "@/modules/invoice-scan/server/scanService";

/**
 * `GET /api/purchases/[id]/invoice-scan` (SCN-09a): escaneo confirmado de la
 * compra con las líneas aprendidas y URLs firmadas de lectura (5 min).
 * `{ data: null }` si la compra no salió de un escaneo; 404 si la compra no es
 * de la tienda de la sesión. Con `?images=0` no firma las imágenes.
 */
export async function GET(request: Request, context: RouteContext<"/api/purchases/[id]/invoice-scan">) {
  try {
    const dataSource = resolveDataSource();
    const ctx = await requireInvoiceScanSession(request, "purchases.view", dataSource);
    const { id } = await context.params;
    const images = new URL(request.url).searchParams.get("images") !== "0";

    return jsonData(await getPurchaseInvoiceScan(createInvoiceScanDeps(dataSource), ctx, id, { images }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
