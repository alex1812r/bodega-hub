import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as categoriesMockServer from "@/modules/products/services/categories.mock-server";
import * as categoriesServer from "@/modules/products/services/categories.server";
import { updateCategorySchema } from "@/modules/products/services/categorySchemas";

function getCategoriesService() {
  return resolveDataSource() === "supabase" ? categoriesServer : categoriesMockServer;
}

export async function GET(request: Request, context: RouteContext<"/api/categories/[id]">) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const { id } = await context.params;
    const service = getCategoriesService();
    return jsonData(await service.getCategoryById(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/categories/[id]">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const input = updateCategorySchema.parse(await readJsonBody(request));
    const service = getCategoriesService();
    return jsonData(await service.updateCategory(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/categories/[id]">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const service = getCategoriesService();
    return jsonData(await service.deleteCategory(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
