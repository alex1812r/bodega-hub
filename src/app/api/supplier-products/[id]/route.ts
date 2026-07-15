import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductUpdateSchema } from "@/modules/contacts/services/supplierProducts.schemas";
import { z } from "zod";

const updateSupplierProductSchema = supplierProductUpdateSchema.extend({
  productId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
});

export async function GET(_request: Request, context: RouteContext<"/api/supplier-products/[id]">) {
  try {
    await requirePermission(_request, "products.view");
    const { id } = await context.params;
    return jsonData(await getSupplierProductsService().getSupplierProductById(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/supplier-products/[id]">) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const input = updateSupplierProductSchema.parse(await request.json());
    return jsonData(await getSupplierProductsService().updateSupplierProduct(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
