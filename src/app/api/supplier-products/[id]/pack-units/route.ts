import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import {
  supplierProductPackUnitInputSchema,
} from "@/modules/contacts/services/supplierProducts.schemas";
import { assertCanAccessSupplierContacts } from "@/shared/auth/contactAccess";

type PackUnitsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: PackUnitsRouteContext) {
  try {
    const auth = await requireStorePermission(request, "products.view");
    assertCanAccessSupplierContacts(auth.role);
    const { id } = await context.params;

    return jsonData(await getSupplierProductsService().listSupplierProductPackUnits(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: PackUnitsRouteContext) {
  try {
    const auth = await requireStorePermission(request, "products.manage");
    assertCanAccessSupplierContacts(auth.role);
    const { id } = await context.params;
    const input = supplierProductPackUnitInputSchema.parse(await request.json());

    return jsonCreated(await getSupplierProductsService().createSupplierProductPackUnit(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
