import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as priceReviewMockServer from "@/modules/products/services/priceReview.mock-server";
import * as priceReviewServer from "@/modules/products/services/priceReview.server";
import { repriceProductsSchema } from "@/modules/products/services/productSchemas";

/**
 * Reprecio masivo al % de ganancia indicado. Acción explícita de quien puede
 * cambiar precios; responde un resultado por producto.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const input = repriceProductsSchema.parse(await readJsonBody(request));

    // En la base la tienda la fija la sesión dentro de la RPC (otra tienda: fila con 404).
    return jsonData(
      resolveDataSource() === "supabase"
        ? await priceReviewServer.repriceProducts(input)
        : priceReviewMockServer.repriceProducts(input, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
