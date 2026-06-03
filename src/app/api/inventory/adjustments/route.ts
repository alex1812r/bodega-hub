import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as inventoryMockServer from "@/modules/inventory/services/inventory.mock-server";
import * as inventoryServer from "@/modules/inventory/services/inventory.server";

const stockAdjustmentSchema = z.object({
  productId: z.string().min(1),
  quantityDelta: z.number().int().refine((value) => value !== 0, {
    message: "El ajuste no puede ser cero.",
  }),
  reason: z.string().optional(),
  type: z
    .enum([
      "ajuste_entrada",
      "ajuste_salida",
      "devolucion_cliente",
      "devolucion_proveedor",
      "inventario_inicial",
    ])
    .optional(),
});

function getInventoryService() {
  return resolveDataSource() === "supabase" ? inventoryServer : inventoryMockServer;
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "inventory.manage");
    const input = stockAdjustmentSchema.parse(await request.json());
    const service = getInventoryService();
    return jsonCreated(await service.createStockAdjustment(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
