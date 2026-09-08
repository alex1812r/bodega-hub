import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

type EmployeeRouteContext = { params: Promise<{ profileId: string }> };

const schema = z.object({
  commissionPct: z.number().min(0).max(100),
  isActive: z.boolean().optional(),
});

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function PUT(request: Request, context: EmployeeRouteContext) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const { profileId } = await context.params;
    const input = schema.parse(await request.json());

    return jsonData(await service().upsertPayrollEmployee(profileId, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
