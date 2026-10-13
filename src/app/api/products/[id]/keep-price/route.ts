import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readOptionalJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as priceReviewMockServer from "@/modules/products/services/priceReview.mock-server";
import * as priceReviewServer from "@/modules/products/services/priceReview.server";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";
import { keepProductPriceSchema } from "@/modules/products/services/productSchemas";

/**
 * "Mantener precio": saca el producto de la cola "Por revisar" sin cambiar su precio.
 * El cuerpo es opcional: sin cuerpo no hay motivo. Uno que no es JSON responde 400.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const input = keepProductPriceSchema.parse(await readOptionalJsonBody(request));

    if (resolveDataSource() === "supabase") {
      const history = await priceReviewServer.keepProductPrice(id, input, auth.storeId);

      return jsonData({ history, product: await productsServer.getProductById(id, auth.storeId) });
    }

    const history = priceReviewMockServer.keepProductPrice(id, input, auth.storeId);

    return jsonData({ history, product: productsMockServer.getProductById(id, auth.storeId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
