import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { toInvoiceDuplicateMatches } from "@/modules/invoice-scan/server/duplicates";
import { loadPreviousScans } from "@/modules/invoice-scan/server/loadMatchContext";
import { listMockPreviousScans } from "@/modules/invoice-scan/server/matchContext.mock-server";

const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_NUMBER_LENGTH = 64;
const MAX_TOTAL = 1e12;

const idSchema = (message: string) => z.string().min(1, message).max(MAX_ID_LENGTH, message).regex(ID_PATTERN, message);

const bodySchema = z
  .strictObject({
    scanId: z.uuid("El identificador del escaneo no es válido.").optional(),
    supplierId: idSchema("El identificador del proveedor no es válido.").optional(),
    contactId: idSchema("El identificador del proveedor leído no es válido.").optional(),
    taxId: z
      .string()
      .trim()
      .min(1, "El RIF no es válido.")
      .max(20, "El RIF no es válido.")
      .regex(/^[A-Za-z0-9 .-]+$/, "El RIF no es válido.")
      .optional(),
    number: z
      .string()
      .trim()
      .min(1, "El número de factura no es válido.")
      .max(MAX_NUMBER_LENGTH, "El número de factura no es válido.")
      .regex(/^[^\p{Cc}]+$/u, "El número de factura no es válido.")
      .optional(),
    date: z.iso.date("La fecha debe tener el formato AAAA-MM-DD.").optional(),
    total: z.number().positive("El total debe ser mayor que 0.").max(MAX_TOTAL, "El total no es válido.").optional(),
  })
  .refine((body) => Boolean(body.supplierId || body.contactId || body.taxId), {
    message: "Indica el proveedor (supplierId, contactId o taxId).",
  })
  .refine((body) => body.number !== undefined || body.total !== undefined, {
    message: "Indica el número de factura o el total.",
  });

/**
 * REP12-01 (M-p12-1, M-p12A-1; D52/D53): solo lectura. Escaneos de la tienda que serían la
 * misma factura que la revisión: mismo número (o fecha + total) y proveedor coincidente por el
 * elegido, el contacto leído o el RIF leído, con la regla de `matched.duplicateOfScanId`. Por
 * POST porque el número es texto de la factura y no va en la URL (D35). Se autoriza con
 * `purchases.create`.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const query = bodySchema.parse(await readJsonBody(request));
    const keys = { number: query.number, date: query.date, total: query.total };

    const previousScans =
      resolveDataSource() === "supabase"
        ? await loadPreviousScans(await createRouteSupabaseClient(), keys, query.scanId)
        : listMockPreviousScans(auth.storeId, keys, query.scanId);

    return jsonData(toInvoiceDuplicateMatches(query, previousScans));
  } catch (error) {
    return toErrorResponse(error);
  }
}
