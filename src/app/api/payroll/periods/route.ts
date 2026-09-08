import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

/** Clave de quincena `YYYY-MM-Q1` / `YYYY-MM-Q2`. */
const schema = z.object({
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-Q[12]$/, {
    message: "La quincena debe tener el formato AAAA-MM-Q1 o AAAA-MM-Q2.",
  }),
});

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const searchParams = new URL(request.url).searchParams;

    return jsonData(await service().listPayrollPeriods(searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const input = schema.parse(await request.json());

    return jsonCreated(await service().createPayrollPeriod(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
