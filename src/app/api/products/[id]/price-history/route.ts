import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";

function getProductsService() {
  return resolveDataSource() === "supabase" ? productsServer : productsMockServer;
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/products/[id]/price-history">,
) {
  try {
    await requirePermission(request, "products.view");
    const { id } = await context.params;
    const service = getProductsService();
    return jsonData(await service.getProductPriceHistory(id, new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}
