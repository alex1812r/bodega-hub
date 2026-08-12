import { z } from "zod";
import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/vault/services/vault.mock-server";
import * as server from "@/modules/vault/services/vault.server";
const schema = z.object({ amountRef: z.number().nonnegative(), amountVes: z.number().nonnegative(), notes: z.string().max(500).optional() }).refine((input) => input.amountRef > 0 || input.amountVes > 0);
const service = () => resolveDataSource() === "supabase" ? server : mock;
export async function POST(request: Request) { try { const auth = await requireStorePermission(request, "vault.manage"); return jsonData(await service().withdrawal(schema.parse(await request.json()), auth.storeId)); } catch (error) { return toErrorResponse(error); } }
