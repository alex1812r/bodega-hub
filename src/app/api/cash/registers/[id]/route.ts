import { z } from "zod";
import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.registers.mock-server";
import * as server from "@/modules/cash/services/cash.registers.server";
const schema = z.object({ assignedUserId: z.string().nullable().optional(), assignedUserName: z.string().nullable().optional(), isActive: z.boolean().optional(), name: z.string().trim().min(1).optional() });
const service = () => resolveDataSource() === "supabase" ? server : mock;
export async function GET(request: Request, context: RouteContext<"/api/cash/registers/[id]">) { try { const auth = await requireStorePermission(request, "cash.view"); const { id } = await context.params; return jsonData(await service().getCashRegister(id, auth.storeId)); } catch (error) { return toErrorResponse(error); } }
export async function PATCH(request: Request, context: RouteContext<"/api/cash/registers/[id]">) { try { const auth = await requireStorePermission(request, "cash.manage"); const { id } = await context.params; return jsonData(await service().updateCashRegister(id, schema.parse(await request.json()), auth.storeId)); } catch (error) { return toErrorResponse(error); } }
