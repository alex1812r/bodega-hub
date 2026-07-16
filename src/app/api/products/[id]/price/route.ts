import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";

const productPriceSchema = z.object({
  salePriceRef: z.number().min(0),
});

export async function POST(request: Request, context: RouteContext<"/api/products/[id]/price">) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;
    const input = productPriceSchema.parse(await request.json());

    if (resolveDataSource() === "supabase") {
      return jsonData(await productsServer.updateProductPrice(id, input, auth.storeId));
    }

    return jsonData({
      history: productsMockServer.createProductPriceHistoryEntry(id, input, auth.storeId),
      product: productsMockServer.updateProductPrice(id, input, auth.storeId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
