import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { requireInvoiceScanSession } from "@/modules/invoice-scan/server/requireScanSession";
import * as mockScans from "@/modules/invoice-scan/server/scans.mock-server";
import * as serverScans from "@/modules/invoice-scan/server/scans.server";
import { INVOICE_MIXED_TYPES_MESSAGE } from "@/modules/invoice-scan/server/scanService";
import {
  createInvoiceUploadUrls,
  createMockInvoiceUploadUrls,
  INVOICE_MAX_PAGES,
  invoiceScanMediaTypes,
} from "@/modules/invoice-scan/server/storage";

/**
 * `types` lleva un MIME por página, separados por comas, o uno solo que vale
 * para todas las páginas. Todas las páginas deben tener el mismo formato, como
 * exige el POST (las rutas p2..pN se derivan de la página 1).
 */
const uploadUrlQuerySchema = z
  .object({
    pages: z.coerce.number().int().min(1).max(INVOICE_MAX_PAGES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "El hash de la factura no es válido."),
    types: z
      .string()
      .transform((value) => value.split(",").map((type) => type.trim()))
      .pipe(z.array(z.enum(invoiceScanMediaTypes)).min(1)),
  })
  .refine((query) => query.types.length === 1 || query.types.length === query.pages, {
    message: "Indica un tipo por página o uno solo para todas.",
    path: ["types"],
  })
  .refine((query) => new Set(query.types).size === 1, {
    message: INVOICE_MIXED_TYPES_MESSAGE,
    path: ["types"],
  });

/**
 * `GET /api/purchases/invoice-scan/upload-url?sha256=…&pages=N&types=image/jpeg,…`
 *
 * URLs firmadas para subir cada página del escaneo directo a Storage, siempre
 * bajo `<storeId>/` de la sesión. En modo mock devuelve URLs falsas deterministas.
 *
 * Respuesta (auditoría M3):
 * - `{ alreadyUploaded: false, uploads }`: una URL firmada por página, sin
 *   upsert (ver `createInvoiceUploadUrls`).
 * - `{ alreadyUploaded: true, storagePaths, uploads: [] }`: la tienda ya tiene
 *   un escaneo `processing`/`extracted`/`confirmed` con ese hash; no se firma
 *   nada para no poder reemplazar sus objetos. El cliente salta la subida y
 *   manda `storagePaths` (las rutas de ese escaneo) al POST, que comprueba el
 *   hash sobre los bytes guardados y sirve la lectura en caché. También
 *   cuando no hay escaneo vivo pero todas las páginas ya están en el bucket
 *   (POST cortado tras el PUT, o reescaneo de un escaneo descartado/fallido):
 *   `storagePaths` son entonces las rutas p1..pN deterministas (REP-03-F1).
 * - `{ alreadyUploaded: false, storagePaths, uploads }`: solo algunas páginas
 *   ya existían; `uploads` firma las que faltan y `storagePaths` trae todas
 *   las rutas p1..pN para el POST.
 */
export async function GET(request: Request) {
  try {
    const dataSource = resolveDataSource();
    // Con datos en Supabase exige una sesión real, no la demo (caos-4 M2).
    const auth = await requireInvoiceScanSession(request, "purchases.create", dataSource);
    const params = new URL(request.url).searchParams;
    const query = uploadUrlQuerySchema.parse({
      pages: params.get("pages") ?? undefined,
      sha256: params.get("sha256") ?? undefined,
      types: params.get("types") ?? undefined,
    });
    const pages = Array.from({ length: query.pages }, (_, index) => ({
      mediaType: query.types[query.types.length === 1 ? 0 : index],
      page: index + 1,
    }));
    const liveScan = await (dataSource === "supabase" ? serverScans : mockScans).findLiveScanByHash(
      auth,
      query.sha256,
    );

    if (liveScan) {
      return jsonData({ alreadyUploaded: true, storagePaths: liveScan.storagePaths, uploads: [] });
    }

    const targets =
      dataSource === "supabase"
        ? await createInvoiceUploadUrls(createAdminSupabaseClient(), auth.storeId, query.sha256, pages)
        : createMockInvoiceUploadUrls(auth.storeId, query.sha256, pages);
    const uploads = targets.filter((target) => !("alreadyExists" in target));

    if (uploads.length === targets.length) {
      return jsonData({ alreadyUploaded: false, uploads });
    }

    const storagePaths = targets.map((target) => target.path);

    return jsonData({ alreadyUploaded: uploads.length === 0, storagePaths, uploads });
  } catch (error) {
    return toErrorResponse(error);
  }
}
