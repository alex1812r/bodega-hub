import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

type ItemRouteContext = { params: Promise<{ id: string }> };

/**
 * `punto_venta` queda fuera a propósito: la nómina sale del baúl y el punto de
 * venta no es una cubeta del baúl. Un recibo en cero admite `amount: 0`.
 */
const schema = z.object({
  amount: z.number().nonnegative(),
  bankName: z.string().trim().max(120).optional(),
  method: z.enum(["efectivo_ves", "efectivo_usd", "pago_movil", "transferencia"]),
  reference: z.string().trim().max(120).optional(),
});

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function POST(request: Request, context: ItemRouteContext) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const { id } = await context.params;
    const input = schema.parse(await request.json());

    return jsonData(await service().payPayrollItem(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
