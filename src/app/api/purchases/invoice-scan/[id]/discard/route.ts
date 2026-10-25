import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireInvoiceScanSession } from "@/modules/invoice-scan/server/requireScanSession";
import { createInvoiceScanDeps, discardInvoiceScan } from "@/modules/invoice-scan/server/scanService";

/**
 * `POST /api/purchases/invoice-scan/[id]/discard`: descarta un escaneo aún sin
 * confirmar. 404 si no es de la tienda; 409 si ya no está `extracted`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/purchases/invoice-scan/[id]/discard">,
) {
  try {
    const dataSource = resolveDataSource();
    // Con datos en Supabase exige una sesión real, no la demo (caos-4 M2).
    const ctx = await requireInvoiceScanSession(request, "purchases.create", dataSource);
    const { id } = await context.params;
    const discarded = await discardInvoiceScan(createInvoiceScanDeps(dataSource), ctx, id);

    return jsonData(discarded);
  } catch (error) {
    return toErrorResponse(error, { zodIssues: "public" });
  }
}
