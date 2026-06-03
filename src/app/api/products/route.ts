import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";

const createProductSchema = z.object({
  categoryId: z.string().optional(),
  currentCostRef: z.number().min(0).optional(),
  currentStock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  name: z.string().min(1),
  salePriceRef: z.number().min(0),
  sku: z.string().min(1),
});

function getProductsService() {
  return resolveDataSource() === "supabase" ? productsServer : productsMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "products.view");
    const service = getProductsService();
    return jsonData(await service.listProducts(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "products.manage");
    const input = createProductSchema.parse(await request.json());
    const service = getProductsService();
    return jsonCreated(await service.createProduct(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
