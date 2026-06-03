import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";

const updateSupplierProductSchema = z.object({
  lastCostRef: z.number().min(0).optional(),
  productId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  supplierSku: z.string().optional(),
});

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
