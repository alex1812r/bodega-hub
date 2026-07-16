import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as categoriesMockServer from "@/modules/products/services/categories.mock-server";
import * as categoriesServer from "@/modules/products/services/categories.server";

const categorySchema = z.object({
  description: z.string().optional(),
  name: z.string().min(1),
});

function getCategoriesService() {
  return resolveDataSource() === "supabase" ? categoriesServer : categoriesMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const service = getCategoriesService();
    return jsonData(await service.listCategories(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const input = categorySchema.parse(await request.json());
    const service = getCategoriesService();
    return jsonCreated(await service.createCategory(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
