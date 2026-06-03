import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";

const supplierProductSchema = z.object({
  lastCostRef: z.number().min(0).optional(),
  productId: z.string().min(1),
  supplierId: z.string().min(1),
  supplierSku: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    await requirePermission(request, "products.view");
    return jsonData(await getSupplierProductsService().listSupplierProducts(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "products.manage");
    const input = supplierProductSchema.parse(await request.json());
    return jsonCreated(await getSupplierProductsService().createSupplierProduct(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
