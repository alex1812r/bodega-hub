import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getContactsService, getSupplierProductsService } from "@/modules/contacts/services";
import { assertCanAccessSupplierContacts } from "@/shared/auth/contactAccess";
import { SUPPLIER_PRODUCTS_PERMISSION } from "@/shared/auth/supplierProductsAccess";

export async function GET(request: Request, context: RouteContext<"/api/suppliers/[id]/products">) {
  try {
    // Misma condición que `canReadSupplierProducts`, que exige también el escaneo de compra (D80).
    const auth = await requireStorePermission(request, SUPPLIER_PRODUCTS_PERMISSION);
    assertCanAccessSupplierContacts(auth.role);
    const { id } = await context.params;
    await getContactsService().getContactById(id, auth.storeId);
    return jsonData(
      await getSupplierProductsService().listSupplierProductsBySupplier(
        id,
        new URL(request.url).searchParams,
        auth.storeId,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
