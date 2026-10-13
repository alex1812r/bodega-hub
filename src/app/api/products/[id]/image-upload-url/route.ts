import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readOptionalJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as productImagesMockServer from "@/modules/products/services/productImages.mock-server";
import * as productImagesServer from "@/modules/products/services/productImages.server";
import { parseProductImageUploadOptions } from "@/modules/products/services/productImageUploadOptions";

function getProductImagesService() {
  return resolveDataSource() === "supabase" ? productImagesServer : productImagesMockServer;
}

export async function POST(request: Request, context: RouteContext<"/api/products/[id]/image-upload-url">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const body = await readOptionalJsonBody(request);
    const { format = "webp" } = parseProductImageUploadOptions(body);
    const service = getProductImagesService();
    return jsonData(await service.createProductImageUploadUrl(id, format, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
