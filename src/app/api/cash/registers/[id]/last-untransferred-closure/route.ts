import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.session.mock-server";
import * as server from "@/modules/cash/services/cash.session.server";

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function GET(
  request: Request,
  context: RouteContext<"/api/cash/registers/[id]/last-untransferred-closure">,
) {
  try {
    const auth = await requireStorePermission(request, "cash.operate");
    const { id } = await context.params;
    return jsonData(await service().getLastUntransferredClosure(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
