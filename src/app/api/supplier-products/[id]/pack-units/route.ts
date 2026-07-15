import { toErrorResponse } from "@/lib/api/apiError";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getSupplierProductsService } from "@/modules/contacts/services";
import {
  supplierProductPackUnitInputSchema,
  supplierProductPackUnitUpdateSchema,
} from "@/modules/contacts/services/supplierProducts.schemas";

type PackUnitsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: PackUnitsRouteContext) {
  try {
    await requirePermission(request, "products.view");
    const { id } = await context.params;

    return jsonData(await getSupplierProductsService().listSupplierProductPackUnits(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, context: PackUnitsRouteContext) {
  try {
    await requirePermission(request, "products.manage");
    const { id } = await context.params;
    const input = supplierProductPackUnitInputSchema.parse(await request.json());

    return jsonCreated(await getSupplierProductsService().createSupplierProductPackUnit(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
