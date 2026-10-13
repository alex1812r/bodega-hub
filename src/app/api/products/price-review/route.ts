import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as priceReviewMockServer from "@/modules/products/services/priceReview.mock-server";
import * as priceReviewServer from "@/modules/products/services/priceReview.server";

function getPriceReviewService() {
  return resolveDataSource() === "supabase" ? priceReviewServer : priceReviewMockServer;
}

/** Cola "Por revisar": productos cuyo costo subió y cuya ganancia bajó de banda. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const service = getPriceReviewService();
    return jsonData(await service.listPriceReview(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
