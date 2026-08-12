import { z } from "zod";
import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.session.mock-server";
import * as server from "@/modules/cash/services/cash.session.server";
const schema = z.object({ closingRef: z.number().nonnegative(), closingVes: z.number().nonnegative(), sessionId: z.string().min(1) });
const service = () => resolveDataSource() === "supabase" ? server : mock;
export async function POST(request: Request) { try { const auth = await requireStorePermission(request, "cash.operate"); return jsonData(await service().closeCashSession(schema.parse(await request.json()), auth.userId ?? "", auth.storeId)); } catch (error) { return toErrorResponse(error); } }
