import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import { addProductBarcodeSchema } from "@/modules/products/services/productSchemas";
import * as productsMockServer from "@/modules/products/services/products.mock-server";
import * as productsServer from "@/modules/products/services/products.server";

function getProductsService() {
  return resolveDataSource() === "supabase" ? productsServer : productsMockServer;
}

/** Asigna barcode solo si el producto no tiene uno (vendedor / cajero). */
export async function POST(request: Request, context: RouteContext<"/api/products/[id]/barcode">) {
  try {
    const auth = await requireStoreAnyPermission(request, [
      "products.view",
      "products.manage",
    ]);
    const { id } = await context.params;
    const input = addProductBarcodeSchema.parse(await request.json());
    const service = getProductsService();
    return jsonData(await service.addProductBarcode(id, input.barcode, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
