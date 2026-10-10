import { z } from "zod";
import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.registers.mock-server";
import * as server from "@/modules/cash/services/cash.registers.server";
import { safeText } from "@/modules/purchases/schemas/safeText";
const schema = z.object({ name: safeText().trim().min(1).max(120) });
const service = () => resolveDataSource() === "supabase" ? server : mock;
export async function GET(request: Request) { try { const auth = await requireStorePermission(request, "cash.view"); return jsonData(await service().listCashRegisters(auth.storeId)); } catch (error) { return toErrorResponse(error); } }
export async function POST(request: Request) { try { const auth = await requireStorePermission(request, "cash.manage"); return jsonCreated(await service().createCashRegister(schema.parse(await readJsonBody(request)), auth.storeId)); } catch (error) { return toErrorResponse(error); } }
