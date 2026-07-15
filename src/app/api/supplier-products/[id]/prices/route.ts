import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductPriceInputSchema } from "@/modules/contacts/services/supplierProducts.schemas";

export async function POST(
  request: Request,
  context: RouteContext<"/api/supplier-products/[id]/prices">,
) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const input = supplierProductPriceInputSchema.parse(await request.json());

    return jsonData(
      await getSupplierProductsService().registerSupplierProductPrice(id, {
        newCostRef: input.newCostRef,
        newCostVes: input.newCostVes,
        newPackCostRef: input.newPackCostRef,
        notes: input.notes,
        origin: input.origin,
        priceInputMode: input.priceInputMode,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
