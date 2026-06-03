import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { cancelSale as cancelSaleMock } from "@/modules/sales/services/sales.mock-server";
import { cancelSale as cancelSaleServer } from "@/modules/sales/services/sales.server";

export async function PATCH(request: Request, context: RouteContext<"/api/sales/[id]/cancel">) {
  try {
    await requirePermission(request, "sales.create");
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase" ? await cancelSaleServer(id) : cancelSaleMock(id);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
