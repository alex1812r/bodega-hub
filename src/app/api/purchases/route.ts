import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

const createPurchaseSchema = z.object({
  discountRef: z.number().min(0).default(0),
  exchangeRateId: z.string().uuid().optional(),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().positive(),
      supplierSku: z.string().optional(),
      unitCostRef: z.number().min(0),
    }),
  ),
  notes: z.string().optional(),
  purchaseNumber: z.string().optional(),
  refRateVes: z.number().positive().optional(),
  status: z.enum(["pedido", "recibido"]).default("recibido"),
  supplierId: z.string().min(1),
  taxRef: z.number().min(0).default(0),
});

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "purchases.view");
    const service = getPurchasesService();
    return jsonData(await service.listPurchases(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "purchases.create");
    const input = createPurchaseSchema.parse(await request.json());
    const service = getPurchasesService();
    return jsonCreated(await service.createPurchase(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
