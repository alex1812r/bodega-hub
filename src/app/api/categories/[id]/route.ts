import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as categoriesMockServer from "@/modules/products/services/categories.mock-server";
import * as categoriesServer from "@/modules/products/services/categories.server";

const updateCategorySchema = z.object({
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).optional(),
});

function getCategoriesService() {
  return resolveDataSource() === "supabase" ? categoriesServer : categoriesMockServer;
}

export async function GET(request: Request, context: RouteContext<"/api/categories/[id]">) {
  try {
    await requirePermission(request, "products.view");
    const { id } = await context.params;
    const service = getCategoriesService();
    return jsonData(await service.getCategoryById(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/categories/[id]">) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const input = updateCategorySchema.parse(await request.json());
    const service = getCategoriesService();
    return jsonData(await service.updateCategory(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/categories/[id]">) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const service = getCategoriesService();
    return jsonData(await service.deleteCategory(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
