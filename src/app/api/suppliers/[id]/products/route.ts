import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getContactsService, getSupplierProductsService } from "@/modules/contacts/services";

export async function GET(request: Request, context: RouteContext<"/api/suppliers/[id]/products">) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    const { id } = await context.params;
    await getContactsService().getContactById(id, auth.storeId);
    return jsonData(
      await getSupplierProductsService().listSupplierProductsBySupplier(
        id,
        new URL(request.url).searchParams,
        auth.storeId,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
