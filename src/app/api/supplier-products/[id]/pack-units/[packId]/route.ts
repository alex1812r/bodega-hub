import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductPackUnitUpdateSchema } from "@/modules/contacts/services/supplierProducts.schemas";

type PackUnitRouteContext = {
  params: Promise<{ id: string; packId: string }>;
};

export async function PATCH(request: Request, context: PackUnitRouteContext) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id, packId } = await context.params;
    const input = supplierProductPackUnitUpdateSchema.parse(await request.json());

    return jsonData(
      await getSupplierProductsService().updateSupplierProductPackUnit(id, packId, input, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: PackUnitRouteContext) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const { id, packId } = await context.params;

    return jsonData(
      await getSupplierProductsService().deactivateSupplierProductPackUnit(id, packId, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
