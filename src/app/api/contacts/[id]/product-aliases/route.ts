import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductAliasesService } from "@/modules/contacts/services";

/** SCN-09b · Alias aprendidos de facturas de un proveedor (misma regla que la RLS: purchases.view). */
export async function GET(request: Request, context: RouteContext<"/api/contacts/[id]/product-aliases">) {
  try {
    const auth = await requireStorePermission(request, "purchases.view");
    const { id } = await context.params;

    return jsonData(await getSupplierProductAliasesService().listSupplierProductAliases(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
