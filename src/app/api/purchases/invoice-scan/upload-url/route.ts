import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import {
  createInvoiceUploadUrls,
  createMockInvoiceUploadUrls,
  INVOICE_MAX_PAGES,
  invoiceScanMediaTypes,
} from "@/modules/invoice-scan/server/storage";

/**
 * `types` lleva un MIME por página, separados por comas, o uno solo que vale
 * para todas las páginas.
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
  });

/**
 * `GET /api/purchases/invoice-scan/upload-url?sha256=…&pages=N&types=image/jpeg,…`
 *
 * URLs firmadas para subir cada página del escaneo directo a Storage, siempre
 * bajo `<storeId>/` de la sesión. En modo mock devuelve URLs falsas deterministas.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
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
    const uploads =
      resolveDataSource() === "supabase"
        ? await createInvoiceUploadUrls(createAdminSupabaseClient(), auth.storeId, query.sha256, pages)
        : createMockInvoiceUploadUrls(auth.storeId, query.sha256, pages);

    return jsonData({ uploads });
  } catch (error) {
    return toErrorResponse(error);
  }
}
