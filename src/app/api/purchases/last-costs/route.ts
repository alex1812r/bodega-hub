import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as purchaseLastCostsMockServer from "@/modules/purchases/services/purchaseLastCosts.mock-server";
import { MAX_LAST_COST_PRODUCT_IDS } from "@/modules/purchases/services/purchaseLastCosts.mock-server";
import * as purchaseLastCostsServer from "@/modules/purchases/services/purchaseLastCosts.server";

const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const supplierIdSchema = z
  .string({ error: "Indica el proveedor (supplierId)." })
  .max(MAX_ID_LENGTH, "El identificador del proveedor no es válido.")
  .regex(ID_PATTERN, "El identificador del proveedor no es válido.");

const productIdSchema = z
  .string()
  .max(MAX_ID_LENGTH, "El identificador de un producto no es válido.")
  .regex(ID_PATTERN, "El identificador de un producto no es válido.");

const querySchema = z.object({
  productIds: z
    .string({ error: "Indica los productos (productIds)." })
    .transform((value) => value.split(","))
    .pipe(
      z
        .array(productIdSchema)
        .max(
          MAX_LAST_COST_PRODUCT_IDS,
          `Se pueden consultar hasta ${MAX_LAST_COST_PRODUCT_IDS} productos a la vez.`,
        ),
    ),
  supplierId: supplierIdSchema,
});

function getPurchaseLastCostsService() {
  return resolveDataSource() === "supabase" ? purchaseLastCostsServer : purchaseLastCostsMockServer;
}

/**
 * Último costo de compra (unitario SIN IVA) de hasta 50 productos, para sugerir el costo
 * de una línea nueva: el de la compra recibida más reciente de `supplierId` y, si ese
 * proveedor nunca lo vendió, el de cualquier proveedor. Se autoriza con `purchases.create`.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const searchParams = new URL(request.url).searchParams;
    const query = querySchema.parse({
      productIds: searchParams.get("productIds") ?? undefined,
      supplierId: searchParams.get("supplierId") ?? undefined,
    });

    return jsonData(await getPurchaseLastCostsService().listPurchaseLastCosts(query, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
