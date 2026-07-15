import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { createProductSchema } from "@/modules/products/services/productSchemas";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";

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
