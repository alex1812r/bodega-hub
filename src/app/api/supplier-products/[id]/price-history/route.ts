import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";

export async function GET(
  request: Request,
  context: RouteContext<"/api/supplier-products/[id]/price-history">,
) {
  try {
    await requirePermission(request, "products.view");
    const { id } = await context.params;

    return jsonData(
      await getSupplierProductsService().listSupplierProductPriceHistory(
        id,
        new URL(request.url).searchParams,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
