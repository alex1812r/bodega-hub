import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

/** El admin nunca es elegible: sus retiros salen del baúl, no de la nómina. */
const schema = z.object({
  commissionSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.")
    .optional(),
  defaultCommissionPct: z.number().min(0).max(100).optional(),
  eligibleRoles: z.array(z.enum(["almacen", "contador", "vendedor"])).min(1).optional(),
  reinvestPct: z.number().min(0).max(100).optional(),
  reservePct: z.number().min(0).max(100).optional(),
  warnShareOfGrossProfitPct: z.number().min(0).max(100).optional(),
});

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");

    return jsonData(await service().getPayrollSettings(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const input = schema.parse(await request.json());

    return jsonData(await service().updatePayrollSettings(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
