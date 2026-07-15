import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as productImagesMockServer from "@/modules/products/services/productImages.mock-server";
import * as productImagesServer from "@/modules/products/services/productImages.server";

function getProductImagesService() {
  return resolveDataSource() === "supabase" ? productImagesServer : productImagesMockServer;
}

export async function DELETE(request: Request, context: RouteContext<"/api/products/[id]/image">) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const service = getProductImagesService();
    return jsonData(await service.deleteProductImage(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
