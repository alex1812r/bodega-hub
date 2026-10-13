import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as priceReviewMockServer from "@/modules/products/services/priceReview.mock-server";
import * as priceReviewServer from "@/modules/products/services/priceReview.server";

function getPriceReviewService() {
  return resolveDataSource() === "supabase" ? priceReviewServer : priceReviewMockServer;
}

/** Cuántos productos hay en la cola "Por revisar" (tarjeta del dashboard). */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const service = getPriceReviewService();
    return jsonData(await service.getPriceReviewSummary(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
