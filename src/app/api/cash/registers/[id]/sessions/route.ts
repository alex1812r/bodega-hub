import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.session.mock-server";
import * as server from "@/modules/cash/services/cash.session.server";

const service = () => (resolveDataSource() === "supabase" ? server : mock);

const MAX_LIMIT = 50;

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/cash/registers/[id]/sessions">,
) {
  try {
    const auth = await requireStorePermission(request, "cash.view");
    const { id } = await context.params;
    const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
    return jsonData(await service().listRegisterSessions(id, auth.storeId, limit));
  } catch (error) {
    return toErrorResponse(error);
  }
}
