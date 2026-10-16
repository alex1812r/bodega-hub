import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductAliasesService } from "@/modules/contacts/services";

/** SCN-09b · Quita un alias aprendido (purchases.create). Ajeno o inexistente → 404. */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/contacts/[id]/product-aliases/[aliasId]">,
) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const { aliasId, id } = await context.params;

    return jsonData(
      await getSupplierProductAliasesService().removeSupplierProductAlias(id, aliasId, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
