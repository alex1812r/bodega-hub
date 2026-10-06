import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { purchaseItemInputSchema } from "@/modules/purchases/schemas/purchaseItem.schema";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

const createPurchaseSchema = z.object({
  // Clave de idempotencia por intento (C6): con la misma clave en la misma tienda
  // el servidor devuelve el resultado original en vez de repetir el movimiento.
  // Opcional para no romper clientes que aun no la envian.
  clientRequestId: z.string().uuid().optional(),
  discountRef: z.number().min(0),
  discountVes: z.number().min(0),
  exchangeRateId: z.string().uuid().optional(),
  items: z.array(purchaseItemInputSchema).min(1),
  notes: z.string().optional(),
  purchaseNumber: z.string().optional(),
  refRateVes: z.number().positive(),
  status: z.enum(["pedido", "recibido"]).default("recibido"),
  subtotalRef: z.number().min(0),
  subtotalVes: z.number().min(0),
  supplierId: z.string().min(1),
  taxRef: z.number().min(0),
  taxVes: z.number().min(0),
});

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.view");
    const service = getPurchasesService();
    return jsonData(await service.listPurchases(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const input = createPurchaseSchema.parse(await readJsonBody(request));
    const service = getPurchasesService();
    return jsonCreated(await service.createPurchase(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
