import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductInputSchema } from "@/modules/contacts/services/supplierProducts.schemas";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    return jsonData(await getSupplierProductsService().listSupplierProducts(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    const input = supplierProductInputSchema.parse(await request.json());
    return jsonCreated(await getSupplierProductsService().createSupplierProduct(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
