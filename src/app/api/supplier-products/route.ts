import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import { supplierProductInputSchema } from "@/modules/contacts/services/supplierProducts.schemas";
import { assertCanAccessSupplierContacts } from "@/shared/auth/contactAccess";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    assertCanAccessSupplierContacts(auth.role);
    return jsonData(await getSupplierProductsService().listSupplierProducts(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    assertCanAccessSupplierContacts(auth.role);
    const input = supplierProductInputSchema.parse(await request.json());
    return jsonCreated(await getSupplierProductsService().createSupplierProduct(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
