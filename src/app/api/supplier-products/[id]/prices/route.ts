import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductPriceInputSchema } from "@/modules/contacts/services/supplierProducts.schemas";
import { assertCanAccessSupplierContacts } from "@/shared/auth/contactAccess";

export async function POST(
  request: Request,
  context: RouteContext<"/api/supplier-products/[id]/prices">,
) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    assertCanAccessSupplierContacts(auth.role);
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
      }, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
