import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import {
  createInvoiceScanDeps,
  INVOICE_MULTIPART_MAX_BYTES,
  multipartTooLarge,
  readUploadedPages,
  scanInvoice,
  type ScanInvoiceInput,
  storedScanBodySchema,
} from "@/modules/invoice-scan/server/scanService";
import { requireInvoiceScanSession } from "@/modules/invoice-scan/server/requireScanSession";

/** Una llamada al modelo por página (45 s de timeout cada una). */
export const maxDuration = 300;

const INVALID_MULTIPART_MESSAGE = "No pudimos leer las páginas enviadas. Vuelve a cargar la factura.";

/**
 * `POST /api/purchases/invoice-scan`: lee una factura y la empareja.
 *
 * - multipart/form-data: `page` (1..10 imágenes, ≤ 4 MB en total), `sha256` y `supplierId` opcionales;
 * - JSON `{ sha256, storagePaths, supplierId? }` tras subir con `upload-url`.
 *
 * El hash se recalcula sobre los bytes y las rutas se validan contra la tienda
 * de la sesión. Mismo hash → mismo escaneo sin llamar al modelo.
 */
export async function POST(request: Request) {
  try {
    const dataSource = resolveDataSource();
    // Con datos en Supabase exige una sesión real, no la demo (caos-4 M2).
    const ctx = await requireInvoiceScanSession(request, "purchases.create", dataSource);

    const contentType = request.headers.get("content-type") ?? "";
    let input: ScanInvoiceInput;

    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > INVOICE_MULTIPART_MAX_BYTES) {
        throw multipartTooLarge();
      }

      const form = await request.formData().catch(() => {
        throw new ApiError(400, "BAD_REQUEST", INVALID_MULTIPART_MESSAGE);
      });
      input = await readUploadedPages(form);
    } else {
      input = { ...storedScanBodySchema.parse(await readJsonBody(request)), source: "storage" as const };
    }

    const result = await scanInvoice(
      createInvoiceScanDeps(dataSource),
      ctx,
      input,
      { signal: request.signal },
    );

    return jsonData(result);
  } catch (error) {
    return toErrorResponse(error, { zodIssues: "public" });
  }
}
