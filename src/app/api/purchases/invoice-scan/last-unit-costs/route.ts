import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { loadLastUnitCostRefs } from "@/modules/invoice-scan/server/loadMatchContext";
import { listMockLastUnitCostRefs } from "@/modules/invoice-scan/server/matchContext.mock-server";

/** Productos que se pueden consultar a la vez (como `GET /api/purchases/last-costs`). */
const MAX_PRODUCT_IDS = 50;
const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const idSchema = (message: string) => z.string().min(1, message).max(MAX_ID_LENGTH, message).regex(ID_PATTERN, message);

const querySchema = z.object({
  productIds: z
    .string({ error: "Indica los productos (productIds)." })
    .transform((value) => value.split(","))
    .pipe(
      z
        .array(idSchema("El identificador de un producto no es válido."))
        .max(MAX_PRODUCT_IDS, `Se pueden consultar hasta ${MAX_PRODUCT_IDS} productos a la vez.`),
    ),
  supplierId: idSchema("El identificador del proveedor no es válido.").optional(),
});

/**
 * D41-a: último costo por unidad de stock (REF) de productos elegidos en la revisión del escaneo
 * fuera de los candidatos (buscador o alta), con la semántica de `InvoiceLineMatch.lastUnitCostRef`
 * (D38). Solo ids en la URL, nunca texto de la factura (D35). Se autoriza con `purchases.create`.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const searchParams = new URL(request.url).searchParams;
    const { productIds, supplierId } = querySchema.parse({
      productIds: searchParams.get("productIds") ?? undefined,
      supplierId: searchParams.get("supplierId") ?? undefined,
    });

    const costs =
      resolveDataSource() === "supabase"
        ? await loadLastUnitCostRefs(await createRouteSupabaseClient(), auth.storeId, productIds, supplierId)
        : listMockLastUnitCostRefs(auth.storeId, productIds);

    return jsonData(costs);
  } catch (error) {
    return toErrorResponse(error, { zodIssues: "public" });
  }
}
