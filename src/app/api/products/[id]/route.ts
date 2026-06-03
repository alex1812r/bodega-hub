import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";

const updateProductSchema = z.object({
  categoryId: z.string().optional(),
  currentCostRef: z.number().min(0).optional(),
  currentStock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  minStock: z.number().int().min(0).optional(),
  name: z.string().min(1).optional(),
  salePriceRef: z.number().min(0).optional(),
  sku: z.string().min(1).optional(),
});

function getProductsService() {
  return resolveDataSource() === "supabase" ? productsServer : productsMockServer;
}

export async function GET(request: Request, context: RouteContext<"/api/products/[id]">) {
  try {
    await requirePermission(request, "products.view");
    const { id } = await context.params;
    const service = getProductsService();
    return jsonData(await service.getProductById(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/products/[id]">) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const input = updateProductSchema.parse(await request.json());
    const service = getProductsService();
    return jsonData(await service.updateProduct(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/products/[id]">) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const service = getProductsService();
    return jsonData(await service.deleteProduct(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
