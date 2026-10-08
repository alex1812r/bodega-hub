import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as priceReviewMockServer from "@/modules/products/services/priceReview.mock-server";
import * as priceReviewServer from "@/modules/products/services/priceReview.server";
import { repriceProductsSchema } from "@/modules/products/services/productSchemas";

function getPriceReviewService() {
  return resolveDataSource() === "supabase" ? priceReviewServer : priceReviewMockServer;
}

/**
 * Reprecio masivo al % de ganancia indicado. Acción explícita de quien puede
 * cambiar precios; responde un resultado por producto.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const input = repriceProductsSchema.parse(await readJsonBody(request));
    const service = getPriceReviewService();
    return jsonData(await service.repriceProducts(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
