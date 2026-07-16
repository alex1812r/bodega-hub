import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/supplier-products/[id]/deactivate">,
) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id } = await context.params;

    return jsonData(await getSupplierProductsService().deactivateSupplierProduct(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
