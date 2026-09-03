import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.session.mock-server";
import * as server from "@/modules/cash/services/cash.session.server";

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "cash.manage");
    return jsonData(await service().listUntransferredClosures(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
