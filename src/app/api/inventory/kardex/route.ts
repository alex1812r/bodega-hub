import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as productKardexMockServer from "@/modules/inventory/services/productKardex.mock-server";
import * as productKardexServer from "@/modules/inventory/services/productKardex.server";

function getProductKardexService() {
  return resolveDataSource() === "supabase" ? productKardexServer : productKardexMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "inventory.view");
    const service = getProductKardexService();

    return jsonData(
      await service.getProductKardex(new URL(request.url).searchParams, auth.storeId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
