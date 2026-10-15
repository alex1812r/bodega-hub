import { ApiError, toErrorResponse, unauthenticatedError } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import {
  createInvoiceScanDeps,
  readUploadedPages,
  scanInvoice,
  type ScanInvoiceInput,
  storedScanBodySchema,
} from "@/modules/invoice-scan/server/scanService";
import { INVOICE_MAX_BYTES, INVOICE_MAX_PAGES } from "@/modules/invoice-scan/server/storage";

/** Una llamada al modelo por página (45 s de timeout cada una). */
export const maxDuration = 300;

/** Margen para las cabeceras multipart y los campos de texto. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_BODY_BYTES = INVOICE_MAX_PAGES * INVOICE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;

const INVALID_MULTIPART_MESSAGE = "No pudimos leer las páginas enviadas. Vuelve a cargar la factura.";
const BODY_TOO_LARGE_MESSAGE = `La factura pesa demasiado: máximo ${INVOICE_MAX_PAGES} páginas de 1 MB.`;

/**
 * `POST /api/purchases/invoice-scan`: lee una factura y la empareja.
 *
 * - multipart/form-data: `page` (1..10 imágenes), `sha256` y `supplierId` opcionales;
 * - JSON `{ sha256, storagePaths, supplierId? }` tras subir con `upload-url`.
 *
 * El hash se recalcula sobre los bytes y las rutas se validan contra la tienda
 * de la sesión. Mismo hash → mismo escaneo sin llamar al modelo.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");

    if (!auth.userId) {
      throw unauthenticatedError();
    }

    const contentType = request.headers.get("content-type") ?? "";
    let input: ScanInvoiceInput;

    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", BODY_TOO_LARGE_MESSAGE);
      }

      const form = await request.formData().catch(() => {
        throw new ApiError(400, "BAD_REQUEST", INVALID_MULTIPART_MESSAGE);
      });
      input = await readUploadedPages(form);
    } else {
      input = { ...storedScanBodySchema.parse(await readJsonBody(request)), source: "storage" as const };
    }

    const result = await scanInvoice(
      createInvoiceScanDeps(resolveDataSource()),
      { storeId: auth.storeId, userId: auth.userId },
      input,
    );

    return jsonData(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
