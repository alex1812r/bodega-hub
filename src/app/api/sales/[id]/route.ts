import { z } from "zod";

import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import {
  getSaleById as getSaleByIdMock,
  updateSale as updateSaleMock,
} from "@/modules/sales/services/sales.mock-server";
import {
  getSaleById as getSaleByIdServer,
  updateSale as updateSaleServer,
} from "@/modules/sales/services/sales.server";

const updateSaleSchema = z
  .object({
    notes: z.string().optional(),
  })
  .refine((value) => value.notes !== undefined, {
    message: "Debes enviar al menos un campo para actualizar.",
  });

export async function GET(request: Request, context: RouteContext<"/api/sales/[id]">) {
  try {
    await requirePermission(request, "sales.view");
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase"
        ? await getSaleByIdServer(id)
        : getSaleByIdMock(id);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/sales/[id]">) {
  try {
    await requirePermission(request, "sales.create");
    const { id } = await context.params;
    const input = updateSaleSchema.parse(await request.json());
    const data =
      resolveDataSource() === "supabase"
        ? await updateSaleServer(id, input)
        : updateSaleMock(id, input);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
