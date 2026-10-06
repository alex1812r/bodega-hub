import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as inventoryMockServer from "@/modules/inventory/services/inventory.mock-server";
import * as inventoryServer from "@/modules/inventory/services/inventory.server";
import { assertReturnAdjustmentHasDocument } from "@/modules/inventory/services/returnAdjustmentDocument";

const stockAdjustmentSchema = z
  .object({
    // Clave de idempotencia por intento (C6): con la misma clave en la misma tienda
    // el servidor devuelve el resultado original en vez de repetir el movimiento.
    // Opcional para no romper clientes que aun no la envian.
    clientRequestId: z.string().uuid().optional(),
    productId: z.string().min(1),
    // R4: compra a la que se liga una `devolucion_proveedor` (obligatoria para ese
    // tipo). Con el vinculo la base aplica el tope "recibido − ya devuelto".
    purchaseId: z.string().uuid().optional(),
    quantityDelta: z.number().int().refine((value) => value !== 0, {
      message: "El ajuste no puede ser cero.",
    }),
    reason: z.string().optional(),
    // R4: venta a la que se liga una `devolucion_cliente` (tope "vendido − ya devuelto").
    saleId: z.string().uuid().optional(),
    type: z
      .enum([
        "ajuste_entrada",
        "ajuste_salida",
        "devolucion_cliente",
        "devolucion_proveedor",
        "inventario_inicial",
      ])
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.saleId !== undefined && value.type !== "devolucion_cliente") {
      context.addIssue({
        code: "custom",
        message: "Solo una devolucion de cliente puede ligarse a una venta.",
        path: ["saleId"],
      });
    }

    if (value.purchaseId !== undefined && value.type !== "devolucion_proveedor") {
      context.addIssue({
        code: "custom",
        message: "Solo una devolucion a proveedor puede ligarse a una compra.",
        path: ["purchaseId"],
      });
    }
  });

function getInventoryService() {
  return resolveDataSource() === "supabase" ? inventoryServer : inventoryMockServer;
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "inventory.manage");
    const input = stockAdjustmentSchema.parse(await readJsonBody(request));
    // R4: fuera del schema para que el 400 lleve su mensaje, no el generico de zod.
    assertReturnAdjustmentHasDocument(input);
    const service = getInventoryService();
    return jsonCreated(await service.createStockAdjustment(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
