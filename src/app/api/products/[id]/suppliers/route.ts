import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { getProductById } from "@/modules/products/services/products.mock-server";
import { getProductById as getProductByIdServer } from "@/modules/products/services/products.server";

export async function GET(request: Request, context: RouteContext<"/api/products/[id]/suppliers">) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const { id } = await context.params;

    if (resolveDataSource() === "mock") {
      getProductById(id, auth.storeId);
    } else {
      await getProductByIdServer(id, auth.storeId);
    }

    return jsonData(
      await getSupplierProductsService().listProductSuppliers(
        id,
        new URL(request.url).searchParams,
        auth.storeId,
      ),
    );  } catch (error) {
    return toErrorResponse(error);
  }
}
