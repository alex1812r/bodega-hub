import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductInputSchema } from "@/modules/contacts/services/supplierProducts.schemas";

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
    const input = supplierProductInputSchema.parse(await request.json());
    return jsonCreated(await getSupplierProductsService().createSupplierProduct(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
