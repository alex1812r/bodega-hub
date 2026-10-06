import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { convertPackToUnitsSchema } from "@/modules/products/services/packConversionSchemas";
import * as inventoryMockServer from "@/modules/inventory/services/inventory.mock-server";
import * as inventoryServer from "@/modules/inventory/services/inventory.server";

const convertPackRequestSchema = convertPackToUnitsSchema.extend({
  // Clave de idempotencia por intento (C6): con la misma clave en la misma tienda
  // el servidor devuelve el resultado original en vez de repetir el movimiento.
  // Opcional para no romper clientes que aun no la envian.
  clientRequestId: z.string().uuid().optional(),
});

function getInventoryService() {
  return resolveDataSource() === "supabase" ? inventoryServer : inventoryMockServer;
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "inventory.manage");
    const input = convertPackRequestSchema.parse(await readJsonBody(request));
    const service = getInventoryService();
    return jsonCreated(await service.convertPackToUnits(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
