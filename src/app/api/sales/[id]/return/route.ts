import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { returnSale as returnSaleMock } from "@/modules/sales/services/sales.mock-server";
import { returnSale as returnSaleServer } from "@/modules/sales/services/sales.server";

export async function POST(request: Request, context: RouteContext<"/api/sales/[id]/return">) {
  try {
    await requirePermission(request, "sales.create");
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase" ? await returnSaleServer(id) : returnSaleMock(id);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
