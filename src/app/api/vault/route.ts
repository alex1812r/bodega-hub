import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/vault/services/vault.mock-server";
import * as server from "@/modules/vault/services/vault.server";
const service = () => resolveDataSource() === "supabase" ? server : mock;
export async function GET(request: Request) { try { const auth = await requireStorePermission(request, "vault.view"); return jsonData(await service().getVault(auth.storeId)); } catch (error) { return toErrorResponse(error); } }
